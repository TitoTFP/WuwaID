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

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Path to where ConfigDB databases are stored
# Resolution order: CLI argv[1] > ../WuwaDBExport > ./WuwaDBExport > ./ConfigDB
CONFIG_DB_DIR = None
# Output folder (created next to this script)
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "export_quest_ordered")
# Languages to export
LANGUAGES = ["zh-Hans", "en", "ja"]


def resolve_config_db_dir(arg: str | None) -> str:
    """Pick the directory holding the Wuwa config DBs.

    Order:
      1. Explicit CLI argument
      2. ``../WuwaDBExport`` next to this script
      3. ``./WuwaDBExport`` (cwd)
      4. ``./ConfigDB`` (legacy layout)
    The first path that contains ``base/db_QuestTree.db`` wins.
    """
    candidates: list[str] = []
    if arg:
        candidates.append(arg)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    candidates.append(os.path.join(repo_root, "data", "db_exports"))
    candidates.append(os.path.join(repo_root, "WuwaDBExport"))
    candidates.append(os.path.join(script_dir, "WuwaDBExport"))
    candidates.append(os.path.join(script_dir, "ConfigDB"))
    candidates.append(os.path.join(os.getcwd(), "WuwaDBExport"))
    candidates.append(os.path.join(os.getcwd(), "ConfigDB"))
    for cand in candidates:
        if os.path.isfile(os.path.join(cand, "base", "db_QuestTree.db")):
            return cand
    return candidates[0]  # fall through; open_db will raise a clear error


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
    """Return the vtable-encoded offset for ``field_index`` or 0 if absent.

    FlatBuffer vtable layout:
        vtable[0:2]                       = vtable size in bytes (uint16)
        vtable[2 + 2*i : 4 + 2*i]         = offset of field i (uint16)
    A vtable entry of 0 means the field is at its default value and the
    offset must be treated as 0 by callers.
    """
    if not bindata:
        return 0
    vtable_size = struct.unpack_from('<H', bindata, vtable)[0]
    needed = 2 + (field_index + 1) * 2
    if needed > vtable_size:
        return 0
    return struct.unpack_from('<H', bindata, vtable + 2 + field_index * 2)[0]


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
    # field 1 = chapter_id, field 2 = name_key (TID)
    return QuestTreeChapterInfo(
        chapter_id=_fb_i32(bindata, root, vtable, 1),
        name_key=_fb_string(bindata, root, vtable, 2),
    )


def decode_questtreenode(bindata: bytes) -> QuestTreeNodeInfo | None:
    if not bindata:
        return None
    root = _fb_root_offset(bindata)
    vtable = _fb_vtable_offset(bindata, root)
    # field layout (verified against the schema):
    #   1 = node_id, 2 = chapter_id, 3 = quest_ids (vec<i32>)
    #   5 = node_type, 6 = quest_type
    #   8 = pre_nodes (vec<i32>), 9 = next_node
    return QuestTreeNodeInfo(
        node_id=_fb_i32(bindata, root, vtable, 1),
        chapter_id=_fb_i32(bindata, root, vtable, 2),
        quest_ids=_fb_vec_i32(bindata, root, vtable, 3),
        node_type=_fb_i32(bindata, root, vtable, 5),
        quest_type=_fb_i32(bindata, root, vtable, 6),
        pre_nodes=_fb_vec_i32(bindata, root, vtable, 8),
        next_node=_fb_i32(bindata, root, vtable, 9),
    )


def decode_questtype(bindata: bytes) -> QuestTypeInfo | None:
    if not bindata:
        return None
    root = _fb_root_offset(bindata)
    vtable = _fb_vtable_offset(bindata, root)
    # field 1 = quest_type_id, 2 = main_type_id, 3 = name_key, 7 = is_show_in_panel
    return QuestTypeInfo(
        quest_type_id=_fb_i32(bindata, root, vtable, 1),
        main_type_id=_fb_i32(bindata, root, vtable, 2),
        name_key=_fb_string(bindata, root, vtable, 3),
        is_show_in_panel=_fb_bool_default(bindata, root, vtable, 7, True),
    )


def order_main_story_nodes_strict(nodes: list[QuestTreeNodeInfo]) -> list[QuestTreeNodeInfo]:
    """Reproduce the game's main-story chain strictly from quest tree links.

    The main story consists of two kinds of questtree nodes:

    * ``node_type == 1`` — the linear chain linked by ``next_node`` /
      ``pre_nodes``.  This is the ordered spine of the chapter.
    * ``node_type == 2`` — parallel branches that anchor onto a chain node
      via ``pre_nodes[0]`` and have ``next_node == 0`` (i.e. they do not
      extend the chain).  They share the main story's ``quest_type == 1``
      and are interleaved after their anchor so the on-disk order matches
      the in-game tree.

    The chain itself is walked strictly with no fallback: ambiguity (no
    root, multiple roots, dangling next, or a cycle) raises ``ValueError``
    because that means the on-disk config has drifted from the build we
    expect.
    """
    main_nodes = [node for node in nodes if node.quest_type == 1 and node.quest_ids]
    if not main_nodes:
        return []

    chain_candidates = [node for node in main_nodes if node.node_type == 1]
    branch_nodes = [node for node in main_nodes if node.node_type == 2]

    node_map = {node.node_id: node for node in chain_candidates}
    roots = [
        node for node in chain_candidates
        if not any(pre_node in node_map for pre_node in node.pre_nodes)
    ]
    roots.sort(key=lambda node: node.node_id)

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

    # Interleave parallel branches after their anchor in the chain.
    anchor_index = {node.node_id: idx for idx, node in enumerate(ordered)}
    branches_by_anchor: dict[int, list[QuestTreeNodeInfo]] = {}
    for branch in branch_nodes:
        anchor = branch.pre_nodes[0] if branch.pre_nodes else 0
        branches_by_anchor.setdefault(anchor, []).append(branch)
    for siblings in branches_by_anchor.values():
        siblings.sort(key=lambda node: node.node_id)

    result: list[QuestTreeNodeInfo] = []
    orphan_anchors: list[int] = []
    for chain_node in ordered:
        result.append(chain_node)
        result.extend(branches_by_anchor.get(chain_node.node_id, []))
    for anchor, siblings in branches_by_anchor.items():
        if anchor not in anchor_index:
            orphan_anchors.append(anchor)
            result.extend(siblings)
    if orphan_anchors:
        print(
            f"         (note) {len(orphan_anchors)} branch anchor(s) not in chain: "
            + ", ".join(str(a) for a in sorted(orphan_anchors))
        )

    missing = [node.node_id for node in main_nodes if node.node_id not in visited
               and not any(b.node_id == node.node_id for b in branch_nodes)]
    if missing:
        raise ValueError(
            "Main quest chain does not cover all main nodes: "
            + ", ".join(str(node_id) for node_id in missing)
        )

    return result


_json_decoder = json.JSONDecoder()


def extract_json_from_bindata(bindata: bytes) -> dict | list | None:
    """Find the first JSON object or array in BinData and parse it.
    Uses raw_decode so trailing binary garbage after the JSON is ignored.
    """
    if not bindata:
        return None
    # Try finding specific JSON patterns first to avoid fake '{' in FlatBuffer headers
    for pattern in (b'{"', b'[{"', b'['):
        idx = 0
        while True:
            idx = bindata.find(pattern, idx)
            if idx == -1:
                break
            try:
                raw = bindata[idx:].decode('utf-8', errors='replace')
                obj, _ = _json_decoder.raw_decode(raw)
                return obj
            except Exception:
                pass
            idx += 1

    # Look for first '{' or '[{' - prefer '[{' if it comes first
    idx = bindata.find(b'{')
    idx2 = bindata.find(b'[{')
    if idx == -1 and idx2 == -1:
        return None
    if idx2 != -1 and (idx == -1 or idx2 < idx):
        idx = idx2
    try:
        raw = bindata[idx:].decode('utf-8', errors='replace')
        obj, _ = _json_decoder.raw_decode(raw)
        return obj
    except Exception:
        # Fallback: trim to first null terminator
        try:
            null_pos = bindata.index(b'\x00', idx)
            raw = bindata[idx:null_pos].decode('utf-8', errors='replace')
            return json.loads(raw)
        except Exception:
            return None


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
    """Recursively walk JSON to collect all (FlowListName, FlowId) pairs."""
    if isinstance(obj, dict):
        # Condition type: {"Type":"PlayFlow","Flow":{"FlowListName":...,"FlowId":...}}
        if obj.get("Type") == "PlayFlow" and "Flow" in obj:
            flow = obj["Flow"]
            if isinstance(flow, dict):
                name = flow.get("FlowListName", "")
                fid = flow.get("FlowId", 0)
                if name and fid:
                    result.add((name, int(fid)))

        # Action type: {"Name":"PlayFlow","Params":{"FlowListName":...,"FlowId":...}}
        # OR:           {"Name":"PlayFlow","Params":{"Flow":{"FlowListName":...}}}
        if obj.get("Name") in ("PlayFlow", "TriggerFlow", "ChangeFlowState"):
            params = obj.get("Params") or {}
            if isinstance(params, dict):
                # Direct form: Params has FlowListName right at top level
                name = params.get("FlowListName", "")
                fid = params.get("FlowId", 0)
                if name and fid:
                    result.add((name, int(fid)))
                # Nested form: Params.Flow.FlowListName
                flow = params.get("Flow") or {}
                if isinstance(flow, dict):
                    name2 = flow.get("FlowListName", "")
                    fid2 = flow.get("FlowId", 0)
                    if name2 and fid2:
                        result.add((name2, int(fid2)))

        for v in obj.values():
            _collect_flows_from_json(v, result)
    elif isinstance(obj, list):
        for item in obj:
            _collect_flows_from_json(item, result)


def get_quest_flows(quest_id: int, qnode_cur: sqlite3.Cursor) -> list[tuple[str, int]]:
    """
    Query all questnodedata rows for quest_id, parse JSON, and collect
    all unique (FlowListName, FlowId) pairs for that quest.
    Returns list sorted by FlowListName for determinism.
    """
    qnode_cur.execute(
        "SELECT BinData FROM questnodedata WHERE Key LIKE ? ORDER BY Key",
        (f"{quest_id}_%",)
    )
    rows = qnode_cur.fetchall()
    found: set[tuple[str, int]] = set()
    for (bindata,) in rows:
        if not bindata:
            continue
        obj = extract_json_from_bindata(bindata)
        if obj is not None:
            _collect_flows_from_json(obj, found)
    return sorted(found)


def _expand_to_all_flowids(base_flows: list[tuple[str, int]],
                            fl_fids: dict[str, set[int]]) -> list[tuple[str, int]]:
    """
    If a quest's qnode references any FlowId in a flowlist, the quest gets
    every FlowId of that flowlist from flowState. Applied to all flowlists
    regardless of single/multi-owner status; multi-owner flowlists produce
    duplicated content across the quests that share them (accepted by
    design — flowlists are story units, the rest of the chapter is
    reachable from the same in-game context even if the qnode doesn't
    explicitly reference every FlowId).
    """
    flowlists_in_use = {fl for fl, _ in base_flows}
    expanded: set[tuple[str, int]] = set(base_flows)
    for fl in flowlists_in_use:
        for fid in fl_fids.get(fl, ()):
            expanded.add((fl, fid))
    return sorted(expanded)


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
    From a single flowstate entry, extract dialogue lines plus the
    surrounding action metadata (plot mode + full action list).

    Returns (lines, plot_mode, actions):
      - lines     : list of {id, speaker_<lang>, text_<lang>, options, ...}
      - plot_mode : last SetPlotMode.Mode seen in this state ("PhoneMessage",
                    "Normal", "BlackScreen", "Chapter", ...). Default "Normal".
      - actions   : compact summary of all actions in the state:
                      [{"name": "...", "params": {...}, "action_id": ...,
                        "action_guid": "..."}, ...]
                    Excludes ShowTalk.TalkItems (already captured per-line)
                    to keep payload small. Use this for the viewer to render
                    plot-mode transitions, fades, branch links, etc.
    """
    actions = _extract_actions_from_bindata(bindata)
    if not actions or not isinstance(actions, list):
        return [], "Normal", []

    plot_mode = "Normal"
    action_summary: list[dict] = []

    for action in actions:
        if not isinstance(action, dict):
            continue
        name = action.get("Name", "")
        params = action.get("Params", {}) or {}
        # Track SetPlotMode transitions in order so the final mode is "current"
        if name == "SetPlotMode" and isinstance(params, dict):
            mode = params.get("Mode")
            if isinstance(mode, str) and mode:
                plot_mode = mode
        # Build a compact summary: drop TalkItems from ShowTalk (per-line data)
        # to avoid duplicating what `lines` already carries.
        if name == "ShowTalk" and isinstance(params, dict):
            stripped = {k: v for k, v in params.items() if k != "TalkItems"}
            action_summary.append({
                "name": name,
                "params": stripped,
                "action_id": action.get("ActionId"),
                "action_guid": action.get("ActionGuid"),
            })
        else:
            action_summary.append({
                "name": name,
                "params": params,
                "action_id": action.get("ActionId"),
                "action_guid": action.get("ActionGuid"),
            })

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
                "state_item_id": item_id,
                "type": item_type,
                "state_key": state_key,
                "text_key": tid_talk,
                "plot_line_id": item.get("PlotLineId"),
                "plot_line_key": item.get("PlotLineKey", ""),
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
                    opt_entry = {
                        "text_key": opt_tid,
                        "plot_line_id": opt.get("PlotLineId"),
                        "plot_line_key": opt.get("PlotLineKey", ""),
                    }
                    # Preserve the action list (JumpTalk, etc.) so the viewer
                    # can render "→ leads to #L<id>" links for each option.
                    opt_actions = opt.get("Actions", [])
                    if isinstance(opt_actions, list) and opt_actions:
                        opt_entry["actions"] = [
                            {
                                "name": a.get("Name", ""),
                                "params": a.get("Params", {}) or {},
                                "action_id": a.get("ActionId"),
                                "action_guid": a.get("ActionGuid"),
                            }
                            for a in opt_actions if isinstance(a, dict)
                        ]
                    for pack in lang_packs:
                        opt_entry[f"text_{pack.lang}"] = pack.get_text(opt_tid)
                    parsed_options.append(opt_entry)
                if parsed_options:
                    entry["options"] = parsed_options

            lines.append(entry)

    return lines, plot_mode, action_summary


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


def renumber_lines_globally(lines: list[dict]) -> None:
    """Renumber each line's `id` to be globally unique within the quest.

    The source `item.Id` is per-state, not per-quest — every state restarts
    at 1. Without this pass, HTML `id="L{id}"` collisions break scroll
    targets and option-branch resolution, and the displayed `#id` chip
    resets inside the same quest (e.g. #1..#19 then back to #1..#3 across
    sub-states of a PhoneMessage flow).

    Each line's original per-state id is preserved in `state_item_id` for
    the verbose display form (`#<global> · S<state>.<sub>.<local>`).
    """
    running = 0
    id_remap: dict[tuple[str, int], int] = {}
    for line in lines:
        running += 1
        sk = line.get("state_key") or ""
        old = line.get("id", 0)
        id_remap[(sk, old)] = running
        line["id"] = running

    for line in lines:
        sk = line.get("state_key") or ""
        for opt in line.get("options", []):
            for a in opt.get("actions", []):
                if a.get("name") == "JumpTalk" and isinstance(a.get("params", {}).get("TalkId"), int):
                    new = id_remap.get((sk, a["params"]["TalkId"]))
                    if new is not None:
                        a["params"]["TalkId"] = new


# ---------------------------------------------------------------------------
# Main export logic
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  Wuthering Waves Quest-Ordered Dialogue Exporter")
    print("=" * 60)

    global CONFIG_DB_DIR
    cli_dir = sys.argv[1] if len(sys.argv) > 1 else None
    CONFIG_DB_DIR = resolve_config_db_dir(cli_dir)
    print(f"Config DB dir: {CONFIG_DB_DIR}")
    if not os.path.isdir(CONFIG_DB_DIR):
        raise FileNotFoundError(
            f"Config DB directory does not exist: {CONFIG_DB_DIR}\n"
            "Pass the path as the first CLI argument, e.g.\n"
            "    python3 export_quest_ordered.py /path/to/WuwaDBExport"
        )

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

    # Folder/label naming: prefer English, fall back to zh-Hans for any key
    # the English pack is missing. Dialogue text/speaker fields still use all
    # LANGUAGES packs (see extract_dialogue_from_flowstate).
    def _find_pack(code: str) -> "LangPack":
        for pack in lang_packs:
            if pack.lang == code:
                return pack
        return lang_packs[0]

    lang_en = _find_pack("en")
    lang_zh = _find_pack("zh-Hans")

    def _display_name(tid: str) -> str:
        if not tid:
            return ""
        return lang_en.get_text(tid) or lang_zh.get_text(tid) or ""

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
        if (node := decode_questtreenode(bindata)) is not None
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

    # Build flowlist -> set of FlowIds index for the all-FlowIds expansion rule.
    fl_fids: dict[str, set[int]] = {}
    for list_name, state_id in state_index.keys():
        fl_fids.setdefault(list_name, set()).add(state_id)

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

        ch_name = _display_name(ch_name_key) if ch_name_key else ""
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

        chapter_lines = 0
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
                quest_name = _display_name(tid_name) if tid_name else ""
                quest_name = quest_name or f"Quest_{quest_id}"

                print(f"  [{quest_idx+1:03d}] Quest {quest_id}: {quest_name}")

                # Find all flows for this quest
                base_flows = get_quest_flows(quest_id, qnode_cur)
                flows = _expand_to_all_flowids(base_flows, fl_fids)
                print(f"         Flows: {len(flows)} (qnode: {len(base_flows)}, expanded +{len(flows) - len(base_flows)})")

                # Collect all dialogue lines from flowstate
                all_lines: list[dict] = []
                flow_details: list[dict] = []

                for flow_name, state_id in flows:
                    entries = state_index.get((flow_name, state_id), [])
                    flow_lines = []
                    flow_states = []
                    for state_key, _, bindata in sorted(entries, key=lambda x: (x[1], x[0])):
                        lines, plot_mode, state_actions = extract_dialogue_from_flowstate(
                            state_key, bindata, lang_packs
                        )
                        flow_lines.extend(lines)
                        flow_states.append({
                            "state_key": state_key,
                            "plot_mode": plot_mode,
                            "actions": state_actions,
                        })
                    if flow_lines:
                        flow_details.append({
                            "flow_list_name": flow_name,
                            "flow_id": state_id,
                            "state_id": state_id,
                            "states": flow_states,
                            "dialogue": flow_lines,
                        })
                    all_lines.extend(flow_lines)

                if not all_lines:
                    print("         Lines: 0")
                    print("         Skipped: no dialogue extracted")
                    continue

                if not has_available_dialogue(all_lines):
                    print(f"         Lines: {len(all_lines)}")
                    print("         Skipped: dialogue is fully masked/unavailable")
                    continue

                renumber_lines_globally(all_lines)

                quest_idx += 1
                q_dir = os.path.join(
                    ch_dir,
                    sanitize_filename(f"{quest_idx:03d}_{quest_name}")
                )
                safe_makedirs(q_dir)

                print(f"         Lines: {len(all_lines)}")
                chapter_lines += len(all_lines)
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

        print(f"  Chapter subtotal: {chapter_lines} lines ({chapter_total_lines} running total)")

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

        if quest_type not in visible_quest_type_ids:
            skipped_hidden_type += 1
            continue

        tid_name = qdata.get("TidName", "")
        quest_name = _display_name(tid_name) if tid_name else ""
        quest_name = quest_name or f"Quest_{quest_id}"

        base_flows = get_quest_flows(quest_id, qnode_cur)
        flows = _expand_to_all_flowids(base_flows, fl_fids)
        if not flows:
            continue  # Skip quests with no flow data at all

        all_lines: list[dict] = []
        flow_details: list[dict] = []

        for flow_name, state_id in flows:
            entries = state_index.get((flow_name, state_id), [])
            flow_lines = []
            flow_states = []
            for state_key, _, bindata in sorted(entries, key=lambda x: (x[1], x[0])):
                lines, plot_mode, state_actions = extract_dialogue_from_flowstate(
                    state_key, bindata, lang_packs
                )
                flow_lines.extend(lines)
                flow_states.append({
                    "state_key": state_key,
                    "plot_mode": plot_mode,
                    "actions": state_actions,
                })
            if flow_lines:
                flow_details.append({
                    "flow_list_name": flow_name,
                    "flow_id": state_id,
                    "state_id": state_id,
                    "states": flow_states,
                    "dialogue": flow_lines,
                })
            all_lines.extend(flow_lines)

        if not all_lines:
            continue

        if not has_available_dialogue(all_lines):
            continue

        renumber_lines_globally(all_lines)

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
    # 8. Summary
    # -----------------------------------------------------------------------
    print(f"\n{'='*60}")
    print("Export complete!")
    print(f"  Output: {OUTPUT_DIR}")
    print(f"  Main story total lines: {chapter_total_lines}")
    print(f"  Side quests exported: {side_count}")
    print(f"{'='*60}")

    db_tree.close()
    db_qdata.close()
    db_qtype.close()
    db_qnode.close()
    db_fstate.close()


if __name__ == "__main__":
    main()
