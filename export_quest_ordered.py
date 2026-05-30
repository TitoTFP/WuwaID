#!/usr/bin/env python3
"""
export_quest_ordered.py
Exports Wuthering Waves dialogue organized by main quest chapters.

Output structure:
  export_quest_ordered/
    Chapter_1_<name>/
      01_<quest_name>/
        dialogue.json   (all flows for this quest)
    Chapter_2_<name>/
      ...
    side_quests/
      <quest_name>/
        dialogue.json

Chain:
    db_questtree.db:
        questtreechapter  -> chapter order and chapter name TID keys (FlatBuffer)
        questtreenode     -> main-story node graph via QuestArray / PreNode / NextNode / SortOrder
  db_QuestData.db:
    questdata         -> quest name (TidName key), type
  db_QuestNodeData.db:
    questnodedata     -> Key="QUESTID_NODEID", BinData=JSON with PlayFlow conditions
                         which have FlowListName + FlowId
  db_flowState.db:
    flowstate         -> StateKey="FlowListName_FlowId_StateId", BinData=actions JSON
                         (ShowTalk actions contain dialogue lines)
  Lang packs (zh-Hans, en, ja):
    lang_multi_text   -> text by TidTalk key
    lang_speaker      -> speaker names by WhoId
"""

import sqlite3
import os
import json
import struct
import re
import sys
import shutil
from dataclasses import dataclass

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Path to where ConfigDB databases are stored
CONFIG_DB_DIR = "WuwaDBExport"
# Output folder (created next to this script)
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "export_quest_ordered")
# Languages to export
LANGUAGES = ["zh-Hans", "en", "ja"]


# Manual overrides for unreferenced flows mapping to specific quest IDs
UNREFERENCED_FLOW_QUEST_OVERRIDES = {
    ("剧情_3_3_拉海洛主线_上半新", 21): 121850000,  # Wishes in the Bell: Epilogue
}


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def open_db(rel_path: str) -> sqlite3.Connection:
    path = os.path.join(CONFIG_DB_DIR, "base", rel_path)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Database not found: {path}")
    return sqlite3.connect(path)


def open_db_first_existing(*rel_paths: str) -> sqlite3.Connection:
    for rel_path in rel_paths:
        path = os.path.join(CONFIG_DB_DIR, "base", rel_path)
        if os.path.isfile(path):
            return sqlite3.connect(path)
    raise FileNotFoundError(
        "Database not found: " + ", ".join(os.path.join(CONFIG_DB_DIR, "base", p) for p in rel_paths)
    )


def safe_makedirs(path: str):
    os.makedirs(path, exist_ok=True)


def sanitize_filename(name: str, max_len: int = 80) -> str:
    """Replace characters illegal in Windows filenames."""
    illegal = r'\/:*?"<>|'
    for c in illegal:
        name = name.replace(c, "_")
    # Also trim trailing periods/spaces
    name = name.strip(". ")
    return name[:max_len] if name else "unnamed"


@dataclass
class QuestTreeChapterInfo:
    chapter_id: int
    name_key: str


HIDDEN_CHAPTER_KEYS = {"QuestTree_Chapter_Hide"}


@dataclass
class QuestTreeNodeInfo:
    node_id: int
    chapter_id: int
    quest_ids: list[int]
    quest_type: int
    node_type: int
    pre_nodes: list[int]
    next_node: int
    sort_order: int
    is_chapter_ending: bool


@dataclass
class QuestTypeInfo:
    quest_type_id: int
    main_type_id: int
    name_key: str
    is_show_in_panel: bool


def _fb_root_offset(bindata: bytes) -> int:
    return struct.unpack_from('<I', bindata, 0)[0]


def _fb_vtable_offset(bindata: bytes, root: int) -> int:
    return root - struct.unpack_from('<i', bindata, root)[0]


def _fb_field_offset(bindata: bytes, root: int, vtable: int, field_index: int) -> int:
    if not bindata:
        return 0
    vtable_size = struct.unpack_from('<H', bindata, vtable)[0]
    return struct.unpack_from('<H', bindata, vtable + field_index)[0] if field_index < vtable_size else 0


def _fb_i32(bindata: bytes, root: int, vtable: int, field_index: int) -> int:
    field_offset = _fb_field_offset(bindata, root, vtable, field_index)
    return struct.unpack_from('<i', bindata, root + field_offset)[0] if field_offset else 0


def _fb_bool(bindata: bytes, root: int, vtable: int, field_index: int) -> bool:
    field_offset = _fb_field_offset(bindata, root, vtable, field_index)
    return bool(struct.unpack_from('<b', bindata, root + field_offset)[0]) if field_offset else False


def _fb_bool_default(bindata: bytes, root: int, vtable: int, field_index: int, default: bool) -> bool:
    field_offset = _fb_field_offset(bindata, root, vtable, field_index)
    return bool(struct.unpack_from('<b', bindata, root + field_offset)[0]) if field_offset else default


def _fb_string(bindata: bytes, root: int, vtable: int, field_index: int) -> str:
    field_offset = _fb_field_offset(bindata, root, vtable, field_index)
    if not field_offset:
        return ""
    field_pos = root + field_offset
    string_pos = field_pos + struct.unpack_from('<I', bindata, field_pos)[0]
    length = struct.unpack_from('<I', bindata, string_pos)[0]
    return bindata[string_pos + 4:string_pos + 4 + length].decode('utf-8', errors='replace')


def _fb_vec_i32(bindata: bytes, root: int, vtable: int, field_index: int) -> list[int]:
    field_offset = _fb_field_offset(bindata, root, vtable, field_index)
    if not field_offset:
        return []
    field_pos = root + field_offset
    vector_pos = field_pos + struct.unpack_from('<I', bindata, field_pos)[0]
    count = struct.unpack_from('<I', bindata, vector_pos)[0]
    return [struct.unpack_from('<i', bindata, vector_pos + 4 + 4 * idx)[0] for idx in range(count)]


def decode_questtree_chapter(bindata: bytes) -> QuestTreeChapterInfo | None:
    if not bindata:
        return None
    root = _fb_root_offset(bindata)
    vtable = _fb_vtable_offset(bindata, root)
    return QuestTreeChapterInfo(
        chapter_id=_fb_i32(bindata, root, vtable, 4),
        name_key=_fb_string(bindata, root, vtable, 6),
    )


def decode_questtree_node(bindata: bytes) -> QuestTreeNodeInfo | None:
    if not bindata:
        return None
    root = _fb_root_offset(bindata)
    vtable = _fb_vtable_offset(bindata, root)
    return QuestTreeNodeInfo(
        node_id=_fb_i32(bindata, root, vtable, 4),
        chapter_id=_fb_i32(bindata, root, vtable, 6),
        quest_ids=_fb_vec_i32(bindata, root, vtable, 8),
        quest_type=_fb_i32(bindata, root, vtable, 12),
        node_type=_fb_i32(bindata, root, vtable, 14),
        pre_nodes=_fb_vec_i32(bindata, root, vtable, 18),
        next_node=_fb_i32(bindata, root, vtable, 20),
        is_chapter_ending=_fb_bool(bindata, root, vtable, 22),
        sort_order=_fb_i32(bindata, root, vtable, 32),
    )


def decode_questtype(bindata: bytes) -> QuestTypeInfo | None:
    if not bindata:
        return None
    root = _fb_root_offset(bindata)
    vtable = _fb_vtable_offset(bindata, root)
    return QuestTypeInfo(
        quest_type_id=_fb_i32(bindata, root, vtable, 4),
        main_type_id=_fb_i32(bindata, root, vtable, 6),
        name_key=_fb_string(bindata, root, vtable, 8),
        is_show_in_panel=_fb_bool_default(bindata, root, vtable, 10, True),
    )


def order_main_story_nodes_strict(nodes: list[QuestTreeNodeInfo]) -> list[QuestTreeNodeInfo]:
    """Reproduce the game's main-story chain strictly from quest tree links.

    We intentionally avoid any fallback or topology repair here. The game has a
    predefined chain already, so if the chapter graph is ambiguous we fail fast
    instead of inferring an order.
    """
    main_nodes = [node for node in nodes if node.quest_type == 1 and node.quest_ids]
    if not main_nodes:
        return []

    node_map = {node.node_id: node for node in main_nodes}
    roots = [
        node for node in main_nodes
        if not any(pre_node in node_map for pre_node in node.pre_nodes)
    ]
    roots.sort(key=lambda node: (node.sort_order, node.node_id))

    if len(roots) != 1:
        raise ValueError(
            "Ambiguous main quest roots: "
            + ", ".join(str(node.node_id) for node in roots)
        )

    ordered: list[QuestTreeNodeInfo] = []
    visited: set[int] = set()
    current = roots[0]

    while current is not None:
        if current.node_id in visited:
            raise ValueError(f"Cycle detected in main quest chain at node {current.node_id}")
        ordered.append(current)
        visited.add(current.node_id)

        if current.next_node == 0:
            current = None
            continue

        next_node = node_map.get(current.next_node)
        if next_node is None:
            raise ValueError(
                f"Main quest chain references missing next node {current.next_node} "
                f"from node {current.node_id}"
            )
        current = next_node

    missing = [node.node_id for node in main_nodes if node.node_id not in visited]
    if missing:
        raise ValueError(
            "Main quest chain does not cover all main nodes: "
            + ", ".join(str(node_id) for node_id in missing)
        )

    return ordered


_json_decoder = json.JSONDecoder()


def extract_json_from_bindata(bindata: bytes) -> dict | list | None:
    """Find the first JSON object or array in BinData and parse it successfully."""
    if not bindata:
        return None
    pos = 0
    while True:
        idx = bindata.find(b'{', pos)
        idx2 = bindata.find(b'[{', pos)
        if idx == -1 and idx2 == -1:
            return None
        if idx2 != -1 and (idx == -1 or idx2 < idx):
            idx = idx2
        try:
            raw = bindata[idx:].decode('utf-8', errors='replace')
            obj, _ = _json_decoder.raw_decode(raw)
            return obj
        except Exception:
            pos = idx + 1


def find_quest_ids_in_bindata(bindata: bytes, valid_ids: set[int] | None = None) -> list[int]:
    """
    Scan BinData for embedded int32 values in range [100_000_000, 400_000_000].
    These are quest IDs stored in questtreenode BinData.
    Excludes known dummy values. If valid_ids is provided, only returns
    IDs present in that set (to filter out non-quest numbers).
    """
    DUMMY = 134220800
    found = set()
    for i in range(0, len(bindata) - 3):
        v = struct.unpack_from('<I', bindata, i)[0]
        if 100_000_000 <= v < 400_000_000 and v != DUMMY:
            found.add(v)
    if valid_ids is not None:
        found = found & valid_ids
    return sorted(found)


def extract_chapter_name_tid(bindata: bytes) -> str:
    """
    Extract the chapter name TID key from questtreechapter BinData.
    The TID key is the last null-terminated UTF-8 string in BinData.
    """
    if not bindata:
        return ""
    strs = []
    i = 0
    while i < len(bindata):
        j = i
        while j < len(bindata) and bindata[j] != 0:
            j += 1
        if j - i >= 4:
            try:
                s = bindata[i:j].decode('utf-8')
                # Only keep strings that look like TID keys or game paths
                if s and not s.startswith('/'):
                    strs.append(s)
            except Exception:
                pass
        i = j + 1
    # Return the last non-path string, which is typically the name TID
    return strs[-1] if strs else ""


# ---------------------------------------------------------------------------
# Speaker map (shared, language-independent base data)
# ---------------------------------------------------------------------------

# Loaded once: speaker_id -> Name index (into lang_speaker) -- fallback only
_speaker_name_index: dict[int, int] = {}
# speaker_id -> stable cross-language text key (e.g. "Speaker_92_Name")
# Built from zh-Hans lang_speaker using NameStringKey; used to look up in
# lang_multi_text so we bypass the lang_speaker ID misalignment between locales.
_speaker_text_key: dict[int, str] = {}

def _load_speaker_base():
    """Load db_speaker.db and build speaker resolution tables.
    Priority path:  speaker_id -> text_key -> lang_multi_text (per language)
    Fallback path:  speaker_id -> Name index -> lang_speaker (broken for en/ja)
    """
    global _speaker_name_index, _speaker_text_key
    if _speaker_name_index:
        return
    path = os.path.join(CONFIG_DB_DIR, "base", "db_speaker.db")
    if not os.path.isfile(path):
        return
    db = sqlite3.connect(path)
    cur = db.cursor()
    row_data: list[tuple[int, int]] = []  # (spk_id, NameStringKey)
    try:
        cur.execute("SELECT Id, NameStringKey, Name FROM speaker")
        for spk_id, nsk, name_idx in cur.fetchall():
            if spk_id is not None:
                _speaker_name_index[spk_id] = name_idx or 0
                row_data.append((spk_id, nsk or 0))
    except Exception:
        pass
    db.close()

    # Build text_key map from zh-Hans lang_speaker.
    # zh-Hans has stable text keys (e.g. "Speaker_92_Name") at NameStringKey
    # positions.  EN/JA have empty strings there, so zh is the reference.
    zh_spk_path = os.path.join(CONFIG_DB_DIR, "zh-Hans", "lang_speaker.db")
    if os.path.isfile(zh_spk_path):
        zh_spk: dict[int, str] = {}
        db2 = sqlite3.connect(zh_spk_path)
        cur2 = db2.cursor()
        try:
            cur2.execute("SELECT Id, Content FROM Speaker")
            for idx, content in cur2.fetchall():
                if idx is not None and content and "_Name" in content:
                    zh_spk[idx] = content
        except Exception:
            pass
        db2.close()
        for spk_id, nsk in row_data:
            key = zh_spk.get(nsk, "")
            if key:
                _speaker_text_key[spk_id] = key


# ---------------------------------------------------------------------------
# Language pack loader
# ---------------------------------------------------------------------------

class LangPack:
    """Loads lang_multi_text.db and lang_speaker.db for one language."""

    def __init__(self, lang: str):
        self.lang = lang
        self._texts: dict[str, str] = {}     # TidKey -> Content
        self._speaker_content: dict[int, str] = {}  # lang_speaker.Id -> Content
        self._loaded = False

    def load(self):
        if self._loaded:
            return
        self._loaded = True
        _load_speaker_base()
        db_dir = os.path.join(CONFIG_DB_DIR, self.lang)

        # Load multi-text with RedirectDbIndex support.
        # lang_multi_text.db has a RedirectDbIndex column:
        #   0 -> text is in lang_multi_text.db itself
        #   1 -> text is in lang_multi_text_1sthalf.db
        #   2 -> text is in lang_multi_text_2ndhalf.db
        half_files = {1: "lang_multi_text_1sthalf.db", 2: "lang_multi_text_2ndhalf.db"}
        half_texts: dict[int, dict[str, str]] = {}
        for idx, db_file in half_files.items():
            txt_path = os.path.join(db_dir, db_file)
            if not os.path.isfile(txt_path):
                continue
            db = sqlite3.connect(txt_path)
            cur = db.cursor()
            try:
                cur.execute("SELECT Id, Content FROM MultiText")
                for tid, content in cur.fetchall():
                    if tid and content:
                        if idx not in half_texts:
                            half_texts[idx] = {}
                        half_texts[idx][tid] = content
            except Exception:
                pass
            db.close()

        main_path = os.path.join(db_dir, "lang_multi_text.db")
        if os.path.isfile(main_path):
            db = sqlite3.connect(main_path)
            cur = db.cursor()
            try:
                cur.execute("SELECT Id, Content, RedirectDbIndex FROM MultiText")
                for tid, content, redirect in cur.fetchall():
                    if not tid:
                        continue

                    redirect = redirect or 0
                    if redirect != 0 and redirect in half_texts:
                        redirected = half_texts[redirect].get(tid, "")
                        if redirected:
                            self._texts[tid] = redirected
                    elif content:
                        self._texts[tid] = content
            except Exception:
                pass
            db.close()

        # Load lang_speaker.db  -> Id (int) -> Content (str)
        spk_path = os.path.join(db_dir, "lang_speaker.db")
        if os.path.isfile(spk_path):
            db = sqlite3.connect(spk_path)
            cur = db.cursor()
            try:
                cur.execute("SELECT Id, Content FROM Speaker")
                for idx, content in cur.fetchall():
                    if idx is not None and content:
                        self._speaker_content[idx] = content
            except Exception:
                pass
            db.close()

    def get_text(self, tid: str) -> str:
        if not tid:
            return ""
        self.load()
        return self._texts.get(tid, "")

    def get_speaker(self, who_id: int) -> str:
        """Resolve WhoId -> speaker display name.

        Resolution order (avoids lang_speaker ID misalignment across locales):
        1. Pre-built text key (e.g. "Speaker_92_Name") -> lang_multi_text
        2. Constructed key "Speaker_{id}_Name" -> lang_multi_text
        3. Fallback: Name index -> lang_speaker (may be wrong for en/ja)
        """
        if not who_id:
            return ""
        self.load()
        # Priority 1: text key from zh-Hans lang_speaker -> lang_multi_text
        text_key = _speaker_text_key.get(who_id, "")
        if text_key:
            result = self._texts.get(text_key, "")
            if result:
                return result
        # Priority 2: constructed key (handles cases where text_key not pre-built)
        constructed = f"Speaker_{who_id}_Name"
        result = self._texts.get(constructed, "")
        if result:
            return result
        # Priority 3: direct lang_speaker lookup (fallback for NPCs not in lang_multi_text)
        name_idx = _speaker_name_index.get(who_id, 0)
        if not name_idx:
            return ""
        return self._speaker_content.get(name_idx, "")


# ---------------------------------------------------------------------------
# Flow list name extraction from QuestNodeData
# ---------------------------------------------------------------------------

def _collect_flows_from_json(obj, result: set):
    """Recursively walk JSON to collect all (FlowListName, FlowId, StateId) tuples."""
    if isinstance(obj, dict):
        name = obj.get("FlowListName")
        fid = obj.get("FlowId")
        if name and fid is not None:
            sid = obj.get("StateId") or obj.get("StateID")
            result.add((name, int(fid), int(sid) if sid is not None else None))
        
        flow = obj.get("Flow")
        if isinstance(flow, dict):
            name = flow.get("FlowListName")
            fid = flow.get("FlowId")
            if name and fid is not None:
                sid = flow.get("StateId") or flow.get("StateID")
                result.add((name, int(fid), int(sid) if sid is not None else None))

        for v in obj.values():
            _collect_flows_from_json(v, result)
    elif isinstance(obj, list):
        for item in obj:
            _collect_flows_from_json(item, result)


def _extract_playflows_from_actions(node: dict) -> list[tuple[str, int, int | None]]:
    """Extract PlayFlow references from a node's Condition, EnterActions then FinishActions."""
    flows = []
    
    # 1. Condition PlayFlow
    cond = node.get("Condition")
    if isinstance(cond, dict) and cond.get("Type") == "PlayFlow":
        flow = cond.get("Flow", {})
        name = flow.get("FlowListName", "")
        fid = flow.get("FlowId") or flow.get("FlowID")
        sid = flow.get("StateId") or flow.get("StateID")
        if name and fid is not None:
            flows.append((name, int(fid), int(sid) if sid is not None else None))
            
    # 2. Action PlayFlows
    for action_list in ["EnterActions", "FinishActions"]:
        for action in node.get(action_list, []):
            if not isinstance(action, dict) or action.get("Name") != "PlayFlow":
                continue
            params = action.get("Params", {})
            name = params.get("FlowListName", "")
            fid = params.get("FlowId") or params.get("FlowID")
            sid = params.get("StateId") or params.get("StateID")
            if name and fid is not None:
                flows.append((name, int(fid), int(sid) if sid is not None else None))
    return flows


def _walk_node(
    node_id: int,
    nodes: dict[int, dict],
    children_map: dict[int, list[int]],
    main_flows: list[tuple[str, int, int | None]],
    alt_flows: list[tuple[str, int, int | None]],
    is_alternative: bool = False,
):
    """Recursively walk the behavior tree in execution order."""
    node = nodes.get(node_id)
    if node is None:
        return
    ntype = node.get("Type", "")
    target = alt_flows if is_alternative else main_flows

    if ntype == "ChildQuest":
        for flow_ref in _extract_playflows_from_actions(node):
            target.append(flow_ref)

    kids = sorted(children_map.get(node_id, []))

    if ntype == "ParallelSelect":
        main_kids = [k for k in kids if nodes.get(k, {}).get("Type") != "AlwaysFalse"]
        alt_kids = [k for k in kids if nodes.get(k, {}).get("Type") == "AlwaysFalse"]
        for kid in main_kids:
            _walk_node(kid, nodes, children_map, main_flows, alt_flows, is_alternative)
        for kid in alt_kids:
            _walk_node(kid, nodes, children_map, main_flows, alt_flows, is_alternative=True)
    elif ntype == "AlwaysFalse":
        for kid in kids:
            _walk_node(kid, nodes, children_map, main_flows, alt_flows, is_alternative=True)
    else:
        for kid in kids:
            _walk_node(kid, nodes, children_map, main_flows, alt_flows, is_alternative)


def walk_quest_tree(
    quest_id: int, qnode_cur: sqlite3.Cursor
) -> tuple[list[tuple[str, int, int | None]], list[tuple[str, int, int | None]]]:
    """Walk the QuestNodeData behavior tree and return PlayFlow refs in execution order.

    Returns:
        (main_flows, alt_flows) where each is an ordered list of
        (FlowListName, FlowId, StateId) tuples — one per PlayFlow action.
        FlowId maps to state_id in the flowstate index.
        StateId maps to sub_id in the flowstate entries.
    """
    qnode_cur.execute(
        "SELECT Key, BinData FROM questnodedata WHERE Key LIKE ? ORDER BY Key",
        (f"{quest_id}_%",)
    )
    rows = qnode_cur.fetchall()
    if not rows:
        return [], []

    nodes: dict[int, dict] = {}
    for key, bindata in rows:
        obj = extract_json_from_bindata(bindata)
        if obj and isinstance(obj, dict):
            nid = obj.get("Id")
            if nid is not None:
                nodes[nid] = obj

    if not nodes:
        return [], []

    children_map: dict[int, list[int]] = {}
    for nid, node in nodes.items():
        pid = node.get("ParentNodeId")
        if pid is not None:
            children_map.setdefault(pid, []).append(nid)

    root_ids = sorted(
        nid for nid, node in nodes.items()
        if node.get("ParentNodeId") not in nodes
    )

    main_flow_refs: list[tuple[str, int, int | None]] = []
    alt_flow_refs: list[tuple[str, int, int | None]] = []
    for rid in root_ids:
        _walk_node(rid, nodes, children_map, main_flow_refs, alt_flow_refs)

    def dedup(refs):
        seen = set()
        result = []
        for ref in refs:
            if ref not in seen:
                seen.add(ref)
                result.append(ref)
        return result

    main_flow_refs = dedup(main_flow_refs)
    alt_flow_refs = dedup(alt_flow_refs)

    main_set = set(main_flow_refs)
    alt_flow_refs = [r for r in alt_flow_refs if r not in main_set]

    for flow_key, qid in UNREFERENCED_FLOW_QUEST_OVERRIDES.items():
        if qid == quest_id:
            name, fid = flow_key
            ref = (name, fid, None)
            if ref not in main_set:
                main_flow_refs.append(ref)

    return main_flow_refs, alt_flow_refs


def get_quest_flows(quest_id: int, qnode_cur: sqlite3.Cursor) -> dict[tuple[str, int], set[int | None]]:
    """
    Query all questnodedata rows for quest_id, parse JSON, and collect
    all unique (FlowListName, FlowId) pairs mapped to their StateIds.
    (Legacy function — kept for get_all_referenced_flows compatibility.)
    """
    qnode_cur.execute(
        "SELECT BinData FROM questnodedata WHERE Key LIKE ? ORDER BY Key",
        (f"{quest_id}_%",)
    )
    rows = qnode_cur.fetchall()
    found: set[tuple[str, int, int | None]] = set()
    for (bindata,) in rows:
        if not bindata:
            continue
        obj = extract_json_from_bindata(bindata)
        if obj is not None:
            _collect_flows_from_json(obj, found)
            
    # Consolidate by (name, fid)
    consolidated: dict[tuple[str, int], set[int | None]] = {}
    for name, fid, sid in found:
        key = (name, fid)
        if key not in consolidated:
            consolidated[key] = set()
        consolidated[key].add(sid)

    # Inject manual unreferenced flow overrides
    for flow_key, qid in UNREFERENCED_FLOW_QUEST_OVERRIDES.items():
        if qid == quest_id:
            if flow_key not in consolidated:
                consolidated[flow_key] = {None}
    return consolidated


def get_all_referenced_flows(qnode_cur: sqlite3.Cursor) -> set[tuple[str, int]]:
    """Collect every flow directly referenced by quest node data."""
    qnode_cur.execute("SELECT BinData FROM questnodedata")
    found: set[tuple[str, int, int | None]] = set()
    for (bindata,) in qnode_cur.fetchall():
        if not bindata:
            continue
        obj = extract_json_from_bindata(bindata)
        if obj is not None:
            _collect_flows_from_json(obj, found)
    res = {(name, fid) for name, fid, sid in found}
    for flow_key in UNREFERENCED_FLOW_QUEST_OVERRIDES:
        res.add(flow_key)
    return res


def get_unreferenced_dialogue_flows(
    flow_names: set[str],
    state_index: dict[tuple[str, int], list[tuple[str, int, bytes]]],
    referenced_flows: set[tuple[str, int]],
    exported_flows: set[tuple[str, int]],
    lang_packs: list[LangPack],
) -> list[tuple[str, int, list[dict]]]:
    """Find dialogue-bearing flow states that questnodedata does not reference.

    Some quest dialogue is triggered by scene logic rather than explicit
    questnodedata PlayFlow entries. If the quest already references the same
    FlowListName, these orphan states are still part of that story flow.
    """
    result: list[tuple[str, int, list[dict]]] = []
    for flow_name, state_id in sorted(state_index):
        flow_key = (flow_name, state_id)
        if flow_name not in flow_names:
            continue
        if flow_key in referenced_flows or flow_key in exported_flows:
            continue

        flow_lines = []
        entries = state_index.get(flow_key, [])
        for state_key, _, bindata in sorted(entries, key=lambda x: (x[1], x[0])):
            lines = extract_dialogue_from_flowstate(state_key, bindata, lang_packs)
            flow_lines.extend(lines)

        if flow_lines and has_available_dialogue(flow_lines):
            result.append((flow_name, state_id, flow_lines))
            exported_flows.add(flow_key)

    return result


# ---------------------------------------------------------------------------
# Dialogue extraction from flowState BinData
# ---------------------------------------------------------------------------

def _extract_actions_from_bindata(bindata: bytes) -> list | None:
    """Extract the top-level array of actions from a flowstate BinData blob.
    Uses raw_decode so trailing binary garbage after the JSON is ignored.
    """
    if not bindata:
        return None
    # The BinData is a FlatBuffer; the actions JSON is embedded
    arr_idx = bindata.find(b'[{')
    if arr_idx == -1:
        arr_idx = bindata.find(b'[')
    if arr_idx == -1:
        return None
    try:
        raw = bindata[arr_idx:].decode('utf-8', errors='replace')
        obj, _ = _json_decoder.raw_decode(raw)
        return obj if isinstance(obj, list) else None
    except Exception:
        # Fallback: trim to first null after array start
        try:
            null_pos = bindata.index(b'\x00', arr_idx)
            raw = bindata[arr_idx:null_pos].decode('utf-8', errors='replace')
            return json.loads(raw)
        except Exception:
            return None


def extract_dialogue_from_flowstate(state_key: str, bindata: bytes,
                                    lang_packs: list[LangPack]) -> list[dict]:
    """
    From a single flowstate entry, extract all ShowTalk dialogue lines.
    Returns list of dicts: {id, speaker_<lang>, text_<lang>, ...}
    """
    actions = _extract_actions_from_bindata(bindata)
    if not actions or not isinstance(actions, list):
        return []

    lines = []
    for action in actions:
        if not isinstance(action, dict):
            continue
        if action.get("Name") != "ShowTalk":
            continue
        params = action.get("Params", {})
        if not isinstance(params, dict):
            continue
        talk_items = params.get("TalkItems", [])
        if not isinstance(talk_items, list):
            continue

        for item in talk_items:
            if not isinstance(item, dict):
                continue
            who_id = item.get("WhoId", 0)
            tid_talk = item.get("TidTalk", "")
            item_id = item.get("Id", 0)
            item_type = item.get("Type", "Talk")

            entry = {
                "id": item_id,
                "type": item_type,
                "state_key": state_key,
                "text_key": tid_talk,
            }

            for pack in lang_packs:
                lang = pack.lang
                entry[f"speaker_{lang}"] = pack.get_speaker(who_id)
                entry[f"text_{lang}"] = pack.get_text(tid_talk)

            options = item.get("Options", [])
            if options and isinstance(options, list):
                parsed_options = []
                for opt in options:
                    if not isinstance(opt, dict):
                        continue
                    opt_tid = opt.get("TidTalkOption", "")
                    opt_entry = {"text_key": opt_tid}
                    for pack in lang_packs:
                        opt_entry[f"text_{pack.lang}"] = pack.get_text(opt_tid)
                    parsed_options.append(opt_entry)
                if parsed_options:
                    entry["options"] = parsed_options

            lines.append(entry)

    return lines


def parse_flowstate_key(state_key: str) -> tuple[str, int, int] | None:
    """Parse a flowstate key as (FlowListName, StateId, SubId).

    In db_flowState, StateKey is laid out as:
      FlowListName_StateId_SubId
    The quest node's FlowId field points at this StateId.
    """
    m = re.match(r'^(.*?)_(\d+)_(\d+)$', state_key)
    if not m:
        return None
    return m.group(1), int(m.group(2)), int(m.group(3))


def has_available_dialogue(lines: list[dict], primary_lang: str = "zh-Hans") -> bool:
    """Return True when at least one line has non-placeholder text."""
    text_key = f"text_{primary_lang}"
    for line in lines:
        text = (line.get(text_key) or "").strip()
        if text and set(text) != {'*'}:
            return True
        for option in line.get("options", []):
            option_text = (option.get(text_key) or "").strip()
            if option_text and set(option_text) != {'*'}:
                return True
    return False


# ---------------------------------------------------------------------------
# Main export logic
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  Wuthering Waves Quest-Ordered Dialogue Exporter")
    print("=" * 60)

    # Open all required databases
    print("Opening databases...")
    db_tree = open_db_first_existing("db_questtree.db", "db_QuestTree.db")
    db_qdata = open_db("db_QuestData.db")
    db_qtype = open_db("db_questtype.db")
    db_qnode = open_db("db_QuestNodeData.db")
    db_fstate = open_db("db_flowState.db")

    tree_cur = db_tree.cursor()
    qdata_cur = db_qdata.cursor()
    qtype_cur = db_qtype.cursor()
    qnode_cur = db_qnode.cursor()
    fstate_cur = db_fstate.cursor()

    # Initialise language packs
    lang_packs = [LangPack(lang) for lang in LANGUAGES]
    print(f"Languages: {LANGUAGES}")

    # Load display names prioritizing English (en) with fallback to Chinese (zh-Hans)
    lang_en = next(pack for pack in lang_packs if pack.lang == "en")
    lang_zh = next(pack for pack in lang_packs if pack.lang == "zh-Hans")

    def get_display_name(tid_key: str) -> str:
        if not tid_key:
            return ""
        name = lang_en.get_text(tid_key)
        if not name:
            name = lang_zh.get_text(tid_key)
        return name

    # -----------------------------------------------------------------------
    # 1. Load quest tree chapters from the authoritative flatbuffer config
    # -----------------------------------------------------------------------
    tree_cur.execute("SELECT Id, BinData FROM questtreechapter ORDER BY Id")
    chapters = [
        chapter for _, bindata in tree_cur.fetchall()
        if (chapter := decode_questtree_chapter(bindata)) is not None
    ]
    print(f"\nFound {len(chapters)} chapters in questtreechapter")

    # -----------------------------------------------------------------------
    # 2. Load quest tree nodes from the authoritative flatbuffer config
    # -----------------------------------------------------------------------
    tree_cur.execute("SELECT Id, ChapterId, BinData FROM questtreenode ORDER BY ChapterId, Id")
    all_nodes = [
        node for _, _, bindata in tree_cur.fetchall()
        if (node := decode_questtree_node(bindata)) is not None
    ]
    print(f"Found {len(all_nodes)} story nodes in questtreenode")

    # -----------------------------------------------------------------------
    # 3. Preload all questdata for fast lookup
    # -----------------------------------------------------------------------
    print("Loading questdata...")
    qdata_cur.execute("SELECT QuestId, BinData FROM questdata")
    questdata_map: dict[int, dict] = {}
    for (qid, bindata) in qdata_cur.fetchall():
        obj = extract_json_from_bindata(bindata)
        if obj and isinstance(obj, dict):
            questdata_map[qid] = obj
    valid_quest_ids = set(questdata_map.keys())
    print(f"  Loaded {len(questdata_map)} quest entries")

    # -----------------------------------------------------------------------
    # 3b. Load quest type visibility from the same config the quest panel uses
    # -----------------------------------------------------------------------
    print("Loading quest types...")
    qtype_cur.execute("SELECT Id, BinData FROM QuestType ORDER BY Id")
    quest_types = [
        quest_type for _, bindata in qtype_cur.fetchall()
        if (quest_type := decode_questtype(bindata)) is not None
    ]
    visible_quest_type_ids = {
        quest_type.quest_type_id
        for quest_type in quest_types
        if quest_type.is_show_in_panel
    }
    print(
        "  Quest panel-visible types: "
        + ", ".join(str(quest_type_id) for quest_type_id in sorted(visible_quest_type_ids))
    )

    # -----------------------------------------------------------------------
    # 4. Preload flowstate index  (FlowListName, FlowId) -> [entries]
    # -----------------------------------------------------------------------
    print("Loading flowstate entries (may take a moment)...")
    fstate_cur.execute("SELECT StateKey, BinData FROM flowstate ORDER BY StateKey")
    all_states = fstate_cur.fetchall()
    print(f"  Loaded {len(all_states)} flow states")

    # Build index: (flow_list_name, state_id) -> list of (state_key, sub_id, bindata)
    state_index: dict[tuple[str, int], list[tuple[str, int, bytes]]] = {}
    for state_key, bindata in all_states:
        parsed = parse_flowstate_key(state_key)
        if not parsed:
            continue
        list_name, state_id, sub_id = parsed
        key = (list_name, state_id)
        if key not in state_index:
            state_index[key] = []
        state_index[key].append((state_key, sub_id, bindata))

    print(f"  Indexed {len(state_index)} flow list/state combinations")

    referenced_flows = get_all_referenced_flows(qnode_cur)
    exported_unreferenced_flows: set[tuple[str, int]] = set()
    exported_flows: set[tuple[str, int]] = set()
    print(f"  Found {len(referenced_flows)} quest-referenced flow states")

    # -----------------------------------------------------------------------
    # 5. Create output directory (clean stale files from prior runs first)
    # -----------------------------------------------------------------------
    if os.path.isdir(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR)
    safe_makedirs(OUTPUT_DIR)
    print(f"\nOutput: {OUTPUT_DIR}")

    # -----------------------------------------------------------------------
    # 6. Export per chapter
    # -----------------------------------------------------------------------
    # Track which quest IDs are covered by the main story tree
    covered_quest_ids: set[int] = set()
    # Track side quests (Type != 1 or not in tree)
    side_quest_ids: list[int] = []

    chapter_total_lines = 0

    for chapter in chapters:
        ch_id = chapter.chapter_id
        ch_name_key = chapter.name_key

        # Hidden placeholder chapters exist in config before release and must not
        # be exported just because unreleased flows are present in client data.
        if ch_name_key in HIDDEN_CHAPTER_KEYS:
            print(f"\nSkipping hidden placeholder chapter {ch_id}: {ch_name_key}")
            continue

        ch_name = get_display_name(ch_name_key) if ch_name_key else ""
        ch_name = ch_name or ch_name_key or f"Chapter_{ch_id}"
        print(f"\n{'='*50}")
        print(f"Chapter {ch_id}: {ch_name}")
        print(f"{'='*50}")

        ch_dir = os.path.join(OUTPUT_DIR, sanitize_filename(f"Chapter_{ch_id}_{ch_name}"))
        safe_makedirs(ch_dir)

        # Get the chapter's main-story node order from the quest tree graph.
        chapter_nodes = [node for node in all_nodes if node.chapter_id == ch_id]
        try:
            ch_nodes = order_main_story_nodes_strict(chapter_nodes)
        except ValueError as exc:
            raise RuntimeError(
                f"Chapter {ch_id} quest tree is ambiguous for strict export: {exc}"
            ) from exc

        quest_idx = 0
        for node in ch_nodes:
            node_id = node.node_id
            quest_ids = [quest_id for quest_id in node.quest_ids if quest_id in valid_quest_ids]
            for quest_id in quest_ids:
                if quest_id in covered_quest_ids:
                    continue
                covered_quest_ids.add(quest_id)

                # Get quest metadata
                qdata = questdata_map.get(quest_id, {})
                quest_type = qdata.get("Type", 0)
                tid_name = qdata.get("TidName", "")
                quest_name = get_display_name(tid_name) if tid_name else f"Quest_{quest_id}"
                quest_name = quest_name or f"Quest_{quest_id}"

                print(f"  [{quest_idx+1:03d}] Quest {quest_id}: {quest_name}")

                # Find all flows for this quest via behavior tree walk
                main_flows, alt_flows = walk_quest_tree(quest_id, qnode_cur)
                print(f"         Flows: {len(main_flows)} main, {len(alt_flows)} alt")

                # Collect all dialogue lines from flowstate
                all_lines: list[dict] = []
                flow_details: list[dict] = []

                all_flow_names: set[str] = set()
                for flow_name, flow_id, sid in main_flows:
                    all_flow_names.add(flow_name)
                    entries = state_index.get((flow_name, flow_id), [])
                    flow_lines = []
                    for state_key, sub_id, bindata in sorted(entries, key=lambda x: (x[1], x[0])):
                        if sid is not None and sub_id != sid:
                            continue
                        lines = extract_dialogue_from_flowstate(
                            state_key, bindata, lang_packs
                        )
                        flow_lines.extend(lines)
                    if flow_lines:
                        exported_flows.add((flow_name, flow_id))
                        flow_details.append({
                            "flow_list_name": flow_name,
                            "flow_id": flow_id,
                            "state_id": sid if sid is not None else flow_id,
                            "dialogue": flow_lines,
                        })
                    all_lines.extend(flow_lines)

                for flow_name, flow_id, sid in alt_flows:
                    all_flow_names.add(flow_name)
                    entries = state_index.get((flow_name, flow_id), [])
                    flow_lines = []
                    for state_key, sub_id, bindata in sorted(entries, key=lambda x: (x[1], x[0])):
                        if sid is not None and sub_id != sid:
                            continue
                        lines = extract_dialogue_from_flowstate(
                            state_key, bindata, lang_packs
                        )
                        flow_lines.extend(lines)
                    if flow_lines:
                        exported_flows.add((flow_name, flow_id))
                        flow_details.append({
                            "flow_list_name": flow_name,
                            "flow_id": flow_id,
                            "state_id": sid if sid is not None else flow_id,
                            "source": "alternative_branch",
                            "dialogue": flow_lines,
                        })
                    all_lines.extend(flow_lines)

                supplemental_flows = get_unreferenced_dialogue_flows(
                    all_flow_names,
                    state_index,
                    referenced_flows,
                    exported_unreferenced_flows,
                    lang_packs,
                )
                if supplemental_flows:
                    print(f"         Supplemental unreferenced flows: {len(supplemental_flows)}")
                for flow_name, state_id, flow_lines in supplemental_flows:
                    exported_flows.add((flow_name, state_id))
                    flow_details.append({
                        "flow_list_name": flow_name,
                        "flow_id": state_id,
                        "state_id": state_id,
                        "source": "unreferenced_flowstate",
                        "dialogue": flow_lines,
                    })
                    all_lines.extend(flow_lines)

                # Deduplicate all_lines by text_key to prevent LevelA/LevelC duplicates
                seen_keys = set()
                deduped_lines = []
                for line in all_lines:
                    tk = line.get("text_key")
                    if tk:
                        if tk in seen_keys:
                            continue
                        seen_keys.add(tk)
                    deduped_lines.append(line)
                all_lines = deduped_lines



                if not all_lines:
                    print("         Lines: 0")
                    print("         Skipped: no dialogue extracted")
                    continue

                if not has_available_dialogue(all_lines):
                    print(f"         Lines: {len(all_lines)}")
                    print("         Skipped: dialogue is fully masked/unavailable")
                    continue

                quest_idx += 1
                q_dir = os.path.join(
                    ch_dir,
                    sanitize_filename(f"{quest_idx:03d}_{quest_name}")
                )
                safe_makedirs(q_dir)

                print(f"         Lines: {len(all_lines)}")
                chapter_total_lines += len(all_lines)

                output = {
                    "chapter_id": ch_id,
                    "chapter_name": ch_name,
                    "node_id": node_id,
                    "quest_id": quest_id,
                    "quest_name": quest_name,
                    "quest_type": quest_type,
                    "languages": LANGUAGES,
                    "total_lines": len(all_lines),
                    "flows": flow_details,
                    "all_lines": all_lines,
                }
                out_path = os.path.join(q_dir, "dialogue.json")
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(output, f, ensure_ascii=False, indent=2)

        if not ch_nodes:
            print(f"  No questtreenodes for Chapter {ch_id}; skipping unreleased/placeholder chapter")
            try:
                os.rmdir(ch_dir)
            except OSError:
                pass

        print(f"  Chapter subtotal: {chapter_total_lines} lines so far")

    # -----------------------------------------------------------------------
    # 7. Export side / extra quests not in QuestTree
    # -----------------------------------------------------------------------
    print(f"\n{'='*50}")
    print("Collecting side quests not in main story tree...")
    uncovered = [qid for qid in questdata_map if qid not in covered_quest_ids]
    print(f"  {len(uncovered)} uncovered quests")

    # Mirror the quest panel's static eligibility first: only quest types that
    # are configured to appear in the UI, and never re-export main story here.
    side_dir = os.path.join(OUTPUT_DIR, "side_quests")
    side_count = 0
    skipped_main_type = 0
    skipped_hidden_type = 0
    for quest_id in sorted(uncovered):
        qdata = questdata_map.get(quest_id, {})
        quest_type = qdata.get("Type", 0)

        if quest_type == 1:
            skipped_main_type += 1
            continue

        # Export all quest types regardless of whether they are visible in the quest panel,
        # as long as they contain dialogue.
        pass

        tid_name = qdata.get("TidName", "")
        quest_name = get_display_name(tid_name) if tid_name else f"Quest_{quest_id}"
        quest_name = quest_name or f"Quest_{quest_id}"

        main_flows, alt_flows = walk_quest_tree(quest_id, qnode_cur)
        if not main_flows and not alt_flows:
            continue  # Skip quests with no flow data at all

        all_lines: list[dict] = []
        flow_details: list[dict] = []

        all_flow_names: set[str] = set()
        for flow_name, flow_id, sid in main_flows:
            all_flow_names.add(flow_name)
            entries = state_index.get((flow_name, flow_id), [])
            flow_lines = []
            for state_key, sub_id, bindata in sorted(entries, key=lambda x: (x[1], x[0])):
                if sid is not None and sub_id != sid:
                    continue
                lines = extract_dialogue_from_flowstate(
                    state_key, bindata, lang_packs
                )
                flow_lines.extend(lines)
            if flow_lines:
                exported_flows.add((flow_name, flow_id))
                flow_details.append({
                    "flow_list_name": flow_name,
                    "flow_id": flow_id,
                    "state_id": sid if sid is not None else flow_id,
                    "dialogue": flow_lines,
                })
            all_lines.extend(flow_lines)

        for flow_name, flow_id, sid in alt_flows:
            all_flow_names.add(flow_name)
            entries = state_index.get((flow_name, flow_id), [])
            flow_lines = []
            for state_key, sub_id, bindata in sorted(entries, key=lambda x: (x[1], x[0])):
                if sid is not None and sub_id != sid:
                    continue
                lines = extract_dialogue_from_flowstate(
                    state_key, bindata, lang_packs
                )
                flow_lines.extend(lines)
            if flow_lines:
                exported_flows.add((flow_name, flow_id))
                flow_details.append({
                    "flow_list_name": flow_name,
                    "flow_id": flow_id,
                    "state_id": sid if sid is not None else flow_id,
                    "source": "alternative_branch",
                    "dialogue": flow_lines,
                })
            all_lines.extend(flow_lines)

        supplemental_flows = get_unreferenced_dialogue_flows(
            all_flow_names,
            state_index,
            referenced_flows,
            exported_unreferenced_flows,
            lang_packs,
        )
        for flow_name, state_id, flow_lines in supplemental_flows:
            exported_flows.add((flow_name, state_id))
            flow_details.append({
                "flow_list_name": flow_name,
                "flow_id": state_id,
                "state_id": state_id,
                "source": "unreferenced_flowstate",
                "dialogue": flow_lines,
            })
            all_lines.extend(flow_lines)

        # Deduplicate all_lines by text_key to prevent LevelA/LevelC duplicates
        seen_keys = set()
        deduped_lines = []
        for line in all_lines:
            tk = line.get("text_key")
            if tk:
                if tk in seen_keys:
                    continue
                seen_keys.add(tk)
            deduped_lines.append(line)
        all_lines = deduped_lines



        if not all_lines:
            continue

        if not has_available_dialogue(all_lines):
            continue

        safe_makedirs(side_dir)
        q_dir = os.path.join(side_dir, sanitize_filename(f"{quest_id}_{quest_name}"))
        safe_makedirs(q_dir)

        output = {
            "quest_id": quest_id,
            "quest_name": quest_name,
            "quest_type": quest_type,
            "languages": LANGUAGES,
            "total_lines": len(all_lines),
            "flows": flow_details,
            "all_lines": all_lines,
        }
        out_path = os.path.join(q_dir, "dialogue.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        side_count += 1

    print(f"  Skipped uncovered Type=1 quests: {skipped_main_type}")
    print(f"  Skipped hidden/non-panel quest types: {skipped_hidden_type}")
    print(f"  Exported {side_count} side/extra quests with dialogue")

    # -----------------------------------------------------------------------
    # 7b. Export remaining unreferenced flows from db_flowState.db
    # -----------------------------------------------------------------------
    print(f"\n{'='*50}")
    print("Collecting remaining unreferenced flows in flowState...")
    unref_dir = os.path.join(OUTPUT_DIR, "unreferenced_flows")
    unref_count = 0
    unref_total_lines = 0

    # Group unexported dialogue-bearing flows by flow_list_name
    grouped_unexported = {}

    for (flow_name, state_id), entries in sorted(state_index.items()):
        if (flow_name, state_id) in exported_flows:
            continue

        flow_lines = []
        for state_key, sub_id, bindata in sorted(entries, key=lambda x: (x[1], x[0])):
            lines = extract_dialogue_from_flowstate(
                state_key, bindata, lang_packs
            )
            flow_lines.extend(lines)

        if flow_lines and has_available_dialogue(flow_lines):
            # Deduplicate by text_key
            seen_keys = set()
            deduped_lines = []
            for line in flow_lines:
                tk = line.get("text_key")
                if tk:
                    if tk in seen_keys:
                        continue
                    seen_keys.add(tk)
                deduped_lines.append(line)
            flow_lines = deduped_lines



            if flow_name not in grouped_unexported:
                grouped_unexported[flow_name] = []
            grouped_unexported[flow_name].append({
                "flow_id": state_id,
                "state_id": state_id,
                "dialogue": flow_lines,
            })

    # Write grouped unreferenced flows to JSON
    for flow_name, flows_list in sorted(grouped_unexported.items()):
        safe_makedirs(unref_dir)
        flow_dir = os.path.join(unref_dir, sanitize_filename(flow_name))
        safe_makedirs(flow_dir)

        all_lines = []
        for f in flows_list:
            all_lines.extend(f["dialogue"])

        # Deduplicate all_lines again
        seen_keys = set()
        deduped_lines = []
        for line in all_lines:
            tk = line.get("text_key")
            if tk:
                if tk in seen_keys:
                    continue
                seen_keys.add(tk)
            deduped_lines.append(line)
        all_lines = deduped_lines



        unref_total_lines += len(all_lines)
        unref_count += 1

        output = {
            "flow_list_name": flow_name,
            "languages": LANGUAGES,
            "total_lines": len(all_lines),
            "flows": flows_list,
            "all_lines": all_lines,
        }
        out_path = os.path.join(flow_dir, "dialogue.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"  Exported {unref_count} unreferenced flow lists with dialogue ({unref_total_lines} lines)")

    # -----------------------------------------------------------------------
    # 8. Summary
    # -----------------------------------------------------------------------
    print(f"\n{'='*60}")
    print("Export complete!")
    print(f"  Output: {OUTPUT_DIR}")
    print(f"  Main story total lines: {chapter_total_lines}")
    print(f"  Side quests exported: {side_count}")
    print(f"  Unreferenced flow lists exported: {unref_count} ({unref_total_lines} lines)")
    print(f"  Grand total dialogue lines: {chapter_total_lines + unref_total_lines} lines")
    print(f"{'='*60}")

    db_tree.close()
    db_qdata.close()
    db_qtype.close()
    db_qnode.close()
    db_fstate.close()


if __name__ == "__main__":
    main()
