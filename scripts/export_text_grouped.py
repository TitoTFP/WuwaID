#!/usr/bin/env python3
"""
export_text_grouped.py
Exports and groups all localization texts from Wuthering Waves databases.

Output structure:
  export_text_grouped/
    export_quest_ordered/    (chapters and side quests)
      Chapter_1_<name>/
        ...
      side_quests/
        ...
    categories/
      Item.json              (all item names and descriptions)
      Skill.json             (all skill descriptions)
      Quest.json             (quest names, metadata, objectives)
      UI.json                (UI labels and components)
      ...
      others.json            (misc small groups)
"""

import sqlite3
import os
import json
import struct
import re
import sys
import shutil
import glob
import time
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CONFIG_DB_DIR = None
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "export_text_grouped")
QUEST_OUTPUT_DIR = os.path.join(OUTPUT_DIR, "export_quest_ordered")
CATEGORIES_OUTPUT_DIR = os.path.join(OUTPUT_DIR, "categories")
LANGUAGES = ["zh-Hans", "en", "ja"]

# Track all dialogue keys exported in the quest-ordered step to exclude from groups
exported_dialogue_keys = set()


def resolve_config_db_dir(arg: str | None) -> str:
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
    return candidates[0]


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
    illegal = r'\/:*?"<>|'
    for c in illegal:
        name = name.replace(c, "_")
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
        chapter_id=_fb_i32(bindata, root, vtable, 1),
        name_key=_fb_string(bindata, root, vtable, 2),
    )


def decode_questtreenode(bindata: bytes) -> QuestTreeNodeInfo | None:
    if not bindata:
        return None
    root = _fb_root_offset(bindata)
    vtable = _fb_vtable_offset(bindata, root)
    # Current QuestTreeNode schema:
    #   1 = node_id, 2 = chapter_id, 3 = quest_ids (vec<i32>)
    #   6 = node_type, 7 = quest_type
    #   9 = pre_nodes (vec<i32>), 10 = next_node
    #
    # Fields 5-10 used to be read one slot too early. In particular, field 8
    # is a scalar on branch nodes, so treating it as a vector produced an
    # out-of-bounds FlatBuffer offset and crashed the export.
    return QuestTreeNodeInfo(
        node_id=_fb_i32(bindata, root, vtable, 1),
        chapter_id=_fb_i32(bindata, root, vtable, 2),
        quest_ids=_fb_vec_i32(bindata, root, vtable, 3),
        node_type=_fb_i32(bindata, root, vtable, 6),
        quest_type=_fb_i32(bindata, root, vtable, 7),
        pre_nodes=_fb_vec_i32(bindata, root, vtable, 9),
        next_node=_fb_i32(bindata, root, vtable, 10),
    )


def decode_questtype(bindata: bytes) -> QuestTypeInfo | None:
    if not bindata:
        return None
    root = _fb_root_offset(bindata)
    vtable = _fb_vtable_offset(bindata, root)
    return QuestTypeInfo(
        quest_type_id=_fb_i32(bindata, root, vtable, 1),
        main_type_id=_fb_i32(bindata, root, vtable, 2),
        name_key=_fb_string(bindata, root, vtable, 3),
        is_show_in_panel=_fb_bool_default(bindata, root, vtable, 7, True),
    )


def order_main_story_nodes_strict(nodes: list[QuestTreeNodeInfo]) -> list[QuestTreeNodeInfo]:
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
            "Ambiguous main quest roots: " + ", ".join(str(node.node_id) for node in roots)
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
                f"Main quest chain references missing next node {current.next_node} from node {current.node_id}"
            )
        current = next_node

    branches_by_anchor: dict[int, list[QuestTreeNodeInfo]] = {}
    for branch in branch_nodes:
        anchor = branch.pre_nodes[0] if branch.pre_nodes else 0
        branches_by_anchor.setdefault(anchor, []).append(branch)
    for siblings in branches_by_anchor.values():
        siblings.sort(key=lambda node: node.node_id)

    result: list[QuestTreeNodeInfo] = []
    for chain_node in ordered:
        result.append(chain_node)
        result.extend(branches_by_anchor.get(chain_node.node_id, []))
    for anchor, siblings in branches_by_anchor.items():
        if anchor not in node_map:
            result.extend(siblings)

    return result


_json_decoder = json.JSONDecoder()


def extract_json_from_bindata(bindata: bytes) -> dict | list | None:
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
        try:
            null_pos = bindata.index(b'\x00', idx)
            raw = bindata[idx:null_pos].decode('utf-8', errors='replace')
            return json.loads(raw)
        except Exception:
            return None


_speaker_name_index: dict[int, int] = {}
_speaker_text_key: dict[int, str] = {}

def _load_speaker_base():
    global _speaker_name_index, _speaker_text_key
    if _speaker_name_index:
        return
    path = os.path.join(CONFIG_DB_DIR, "base", "db_speaker.db")
    if not os.path.isfile(path):
        return
    db = sqlite3.connect(path)
    cur = db.cursor()
    row_data: list[tuple[int, int]] = []
    try:
        cur.execute("SELECT Id, NameStringKey, Name FROM speaker")
        for spk_id, nsk, name_idx in cur.fetchall():
            if spk_id is not None:
                _speaker_name_index[spk_id] = name_idx or 0
                row_data.append((spk_id, nsk or 0))
    except Exception:
        pass
    db.close()

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


class LangPack:
    def __init__(self, lang: str):
        self.lang = lang
        self._texts: dict[str, str] = {}
        self._speaker_content: dict[int, str] = {}
        self._loaded = False

    def load(self):
        if self._loaded:
            return
        self._loaded = True
        _load_speaker_base()
        db_dir = os.path.join(CONFIG_DB_DIR, self.lang)

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
                        half_texts.setdefault(idx, {})[tid] = content
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
        if not who_id:
            return ""
        self.load()
        text_key = _speaker_text_key.get(who_id, "")
        if text_key:
            result = self._texts.get(text_key, "")
            if result:
                return result
        constructed = f"Speaker_{who_id}_Name"
        result = self._texts.get(constructed, "")
        if result:
            return result
        name_idx = _speaker_name_index.get(who_id, 0)
        if not name_idx:
            return ""
        return self._speaker_content.get(name_idx, "")


def _collect_flows_from_json(obj, result: set):
    if isinstance(obj, dict):
        if 'FlowListName' in obj:
            name = obj['FlowListName']
            fid = obj.get('FlowId') or obj.get('FlowID') or 0
            if name:
                result.add((name, int(fid)))
        for v in obj.values():
            _collect_flows_from_json(v, result)
    elif isinstance(obj, list):
        for item in obj:
            _collect_flows_from_json(item, result)


def get_quest_flows(quest_id: int, qnode_cur: sqlite3.Cursor) -> list[tuple[str, int]]:
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
    flowlists_in_use = {fl for fl, _ in base_flows}
    expanded: set[tuple[str, int]] = set(base_flows)
    for fl in flowlists_in_use:
        for fid in fl_fids.get(fl, ()):
            expanded.add((fl, fid))
    return sorted(expanded)


def _extract_actions_from_bindata(bindata: bytes) -> list | None:
    if not bindata:
        return None
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
        try:
            null_pos = bindata.index(b'\x00', arr_idx)
            raw = bindata[arr_idx:null_pos].decode('utf-8', errors='replace')
            return json.loads(raw)
        except Exception:
            return None


def extract_dialogue_from_flowstate(state_key: str, bindata: bytes,
                                    lang_packs: list[LangPack]) -> list[dict]:
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
        if name == "SetPlotMode" and isinstance(params, dict):
            mode = params.get("Mode")
            if isinstance(mode, str) and mode:
                plot_mode = mode
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

            # Collect dialogue key to exclude it from grouped categories
            if tid_talk:
                exported_dialogue_keys.add(tid_talk)

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
                    
                    # Collect option dialogue key to exclude it
                    if opt_tid:
                        exported_dialogue_keys.add(opt_tid)

                    opt_entry = {
                        "text_key": opt_tid,
                        "plot_line_id": opt.get("PlotLineId"),
                        "plot_line_key": opt.get("PlotLineKey", ""),
                    }
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
    m = re.match(r'^(.*?)_(\d+)_(\d+)$', state_key)
    if not m:
        return None
    return m.group(1), int(m.group(2)), int(m.group(3))


def has_available_dialogue(lines: list[dict], primary_lang: str = "zh-Hans") -> bool:
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
# Database scan for TidKey references mapping
# ---------------------------------------------------------------------------

DB_TO_CATEGORY = {
    "db_item.db": "Item",
    "db_bag.db": "Item",
    "db_skill.db": "Skill",
    "db_skillTree.db": "Skill",
    "db_PassiveSkill.db": "Skill",
    "db_QuestData.db": "Quest",
    "db_quest.db": "Quest",
    "db_QuestNodeData.db": "Quest",
    "db_QuestTree.db": "Quest",
    "db_quest_chapter.db": "Quest",
    "db_quest_step.db": "Quest",
    "db_questtype.db": "Quest",
    "db_weapon.db": "Weapon",
    "db_monster_Info.db": "Monster",
    "db_monsterDisplay.db": "Monster",
    "db_achievement.db": "Achievement",
    "db_ui_prefabTextItem.db": "UI",
    "db_ui_prefabRichTextData.db": "UI",
    "db_ui.db": "UI",
    "db_Rogue.db": "Rogue",
    "db_PermanentRogue.db": "Rogue",
    "db_WeeklyRogue.db": "Rogue",
    "db_guide_new.db": "Guide",
    "db_LevelPlayData.db": "LevelPlay",
    "db_LevelPlayNodeData.db": "LevelPlay",
    "db_levelgameplay.db": "LevelPlay",
    "db_favor.db": "Favor",
    "db_map_mark.db": "Map",
    "db_mapnote.db": "Map",
    "db_map.db": "Map",
    "db_activity.db": "Activity",
    "db_ActivityGamePlayPlot.db": "Activity",
    "db_ActivityLinkage.db": "Activity",
    "db_ActivityMapTravel.db": "Activity",
    "db_instance_dungeon.db": "Dungeon",
    "db_instance_dungeon_step.db": "Dungeon",
    "db_confirmbox.db": "ConfirmBox",
    "db_help.db": "Help",
    "db_advice.db": "Advice",
    "db_cook.db": "Cook",
    "db_compose.db": "Compose",
    "db_forge.db": "Forge",
    "db_gacha.db": "Gacha",
    "db_chat.db": "Chat",
    "db_generic_tips.db": "GenericTips",
    "db_loadingtips.db": "LoadingTips",
    "db_battle_pass.db": "BattlePass",
    "db_buff.db": "Buff",
    "db_error_code.db": "ErrorCode",
    "db_speaker.db": "Speaker",
    "db_role.db": "Role",
    "db_roleDescription.db": "Role",
    "db_skin.db": "RoleSkin",
    "db_cgVedio.db": "CGVideo",
    "db_handbook.db": "Handbook"
}

PREFIX_FALLBACK_CATEGORIES = {
    "Quest": "Quest",
    "LevelPlay": "LevelPlay",
    "Skill": "Skill",
    "SkillDescription": "Skill",
    "SkillTree": "Skill",
    "PassiveSkill": "Skill",
    "PhantomSkill": "Skill",
    "RoleSkillInput": "Skill",
    "Rogue": "Rogue",
    "RogueRes": "Rogue",
    "RogueBuffPool": "Rogue",
    "RogueEvent": "Rogue",
    "Guide": "Guide",
    "GuideFocusNew": "Guide",
    "GuideTutorial": "Guide",
    "GuideTutorialPage": "Guide",
    "InstanceDungeon": "Dungeon",
    "InstanceDungeonEntrance": "Dungeon",
    "Weapon": "Weapon",
    "WeaponConf": "Weapon",
    "WeaponReson": "Weapon",
    "Condition": "Condition",
    "ConditionGroup": "Condition",
    "Daily": "Daily",
    "Daliy": "Daily",
    "NPC": "NPC",
    "GNNPC": "NPC",
    "STNPC": "NPC",
    "Speaker": "Speaker",
    "Character": "Character",
    "Event": "Event",
    "POI": "POI",
    "Favor": "Favor",
    "FavorWord": "Favor",
    "FavorStory": "Favor",
    "FavorGoods": "Favor",
    "Item": "Item",
    "ItemInfo": "Item",
    "Entity": "Entity",
    "Flow": "Flow",
    "PrefabTextItem": "UI",
    "ErrorCode": "ErrorCode",
    "Achievement": "Achievement",
    "ComboTeaching": "ComboTeaching",
    "InfoDisplay": "InfoDisplay",
    "MapMark": "Map",
    "ConfirmBox": "ConfirmBox",
    "Help": "Help",
    "HelpText": "Help",
    "Activity": "Activity",
    "LoadingTipsText": "LoadingTips"
}


def build_tid_to_db_map(all_keys: set) -> dict[str, str]:
    """Scan all sqlite databases in base/ and map each TidKey to its category."""
    print("\nScanning database files in base/ to build robust key mappings...")
    start_time = time.time()
    
    base_dir = os.path.join(CONFIG_DB_DIR, "base")
    db_files = glob.glob(os.path.join(base_dir, "*.db"))
    
    tid_pattern = re.compile(r'\b[a-zA-Z][a-zA-Z0-9_]{3,80}\b')
    key_to_category = {}
    
    # Exclude extremely large voxel/preload databases to keep execution fast
    skip_keywords = ["level_entity", "EntityVoxelInfo", "template", "bullet_preload", "ai"]
    
    for db_path in sorted(db_files):
        db_name = os.path.basename(db_path)
        if any(kw in db_name for kw in skip_keywords):
            continue
            
        file_size = os.path.getsize(db_path)
        if file_size > 15 * 1024 * 1024:
            continue
            
        category = DB_TO_CATEGORY.get(db_name)
        if not category:
            continue
            
        try:
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [r[0] for r in cur.fetchall()]
            
            for table in tables:
                cur.execute(f"PRAGMA table_info({table})")
                cols = cur.fetchall()
                text_blob_cols = [c[1] for c in cols if "TEXT" in c[2].upper() or "BLOB" in c[2].upper() or "NONE" in c[2].upper()]
                
                if not text_blob_cols:
                    continue
                    
                col_selectors = ", ".join(f"`{c}`" for c in text_blob_cols)
                cur.execute(f"SELECT {col_selectors} FROM `{table}`")
                
                for row in cur.fetchall():
                    for val in row:
                        if not val:
                            continue
                        
                        strings_to_check = []
                        if isinstance(val, str):
                            strings_to_check.append(val)
                        elif isinstance(val, bytes):
                            try:
                                decoded = val.decode('utf-8', errors='ignore')
                                strings_to_check.extend(tid_pattern.findall(decoded))
                            except Exception:
                                pass
                        
                        for s in strings_to_check:
                            if s in all_keys:
                                # Prioritize item/skill/monster specific tables if a key is in multiple
                                if s not in key_to_category or category in ("Item", "Skill", "Monster", "Quest", "Weapon"):
                                    key_to_category[s] = category
                            elif "_" in s:
                                for word in tid_pattern.findall(s):
                                    if word in all_keys:
                                        if word not in key_to_category or category in ("Item", "Skill", "Monster", "Quest", "Weapon"):
                                            key_to_category[word] = category
                                            
            conn.close()
        except Exception:
            pass
            
    print(f"Mapped {len(key_to_category)} keys to database categories in {time.time() - start_time:.2f} seconds.")
    return key_to_category


# ---------------------------------------------------------------------------
# Main function
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  Wuthering Waves Text Exporter (Grouped & Ordered)")
    print("=" * 60)

    global CONFIG_DB_DIR
    cli_dir = sys.argv[1] if len(sys.argv) > 1 else None
    CONFIG_DB_DIR = resolve_config_db_dir(cli_dir)
    print(f"Config DB dir: {CONFIG_DB_DIR}")
    if not os.path.isdir(CONFIG_DB_DIR):
        raise FileNotFoundError(f"Config DB directory does not exist: {CONFIG_DB_DIR}")

    # -----------------------------------------------------------------------
    # Part 1: Quest-Ordered Dialogue Export
    # -----------------------------------------------------------------------
    print("\n[PART 1] Running Quest-Ordered Dialogue Export...")
    
    # Open databases
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
    
    def _find_pack(code: str) -> LangPack:
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

    # Load quest tree chapters
    tree_cur.execute("SELECT Id, BinData FROM questtreechapter ORDER BY Id")
    chapters = [
        chapter for _, bindata in tree_cur.fetchall()
        if (chapter := decode_questtree_chapter(bindata)) is not None
    ]

    # Load quest tree nodes
    tree_cur.execute("SELECT Id, ChapterId, BinData FROM questtreenode ORDER BY ChapterId, Id")
    all_nodes = [
        node for _, _, bindata in tree_cur.fetchall()
        if (node := decode_questtreenode(bindata)) is not None
    ]

    # Preload questdata
    qdata_cur.execute("SELECT QuestId, BinData FROM questdata")
    questdata_map: dict[int, dict] = {}
    for (qid, bindata) in qdata_cur.fetchall():
        obj = extract_json_from_bindata(bindata)
        if obj and isinstance(obj, dict):
            questdata_map[qid] = obj
    valid_quest_ids = set(questdata_map.keys())

    # Load quest type visibility
    qtype_cur.execute("SELECT Id, BinData FROM QuestType ORDER BY Id")
    quest_types = [
        quest_type for _, bindata in qtype_cur.fetchall()
        if (quest_type := decode_questtype(bindata)) is not None
    ]
    visible_quest_type_ids = {
        quest_type.quest_type_id for quest_type in quest_types if quest_type.is_show_in_panel
    }

    # Preload flowstate index
    fstate_cur.execute("SELECT StateKey, BinData FROM flowstate ORDER BY StateKey")
    all_states = fstate_cur.fetchall()
    
    state_index: dict[tuple[str, int], list[tuple[str, int, bytes]]] = {}
    for state_key, bindata in all_states:
        parsed = parse_flowstate_key(state_key)
        if not parsed:
            continue
        list_name, state_id, sub_id = parsed
        state_index.setdefault((list_name, state_id), []).append((state_key, sub_id, bindata))

    fl_fids: dict[str, set[int]] = {}
    for list_name, state_id in state_index.keys():
        fl_fids.setdefault(list_name, set()).add(state_id)

    # Re-create cleanly the output folders
    if os.path.isdir(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR)
    safe_makedirs(OUTPUT_DIR)
    safe_makedirs(QUEST_OUTPUT_DIR)
    safe_makedirs(CATEGORIES_OUTPUT_DIR)

    covered_quest_ids: set[int] = set()
    chapter_total_lines = 0

    for chapter in chapters:
        ch_id = chapter.chapter_id
        ch_name_key = chapter.name_key

        if ch_name_key in HIDDEN_CHAPTER_KEYS:
            continue

        ch_name = _display_name(ch_name_key) if ch_name_key else ""
        ch_name = ch_name or ch_name_key or f"Chapter_{ch_id}"
        
        ch_dir = os.path.join(QUEST_OUTPUT_DIR, sanitize_filename(f"Chapter_{ch_id}_{ch_name}"))
        safe_makedirs(ch_dir)

        chapter_nodes = [node for node in all_nodes if node.chapter_id == ch_id]
        try:
            ch_nodes = order_main_story_nodes_strict(chapter_nodes)
        except ValueError:
            continue

        chapter_lines = 0
        quest_idx = 0
        for node in ch_nodes:
            quest_ids = [quest_id for quest_id in node.quest_ids if quest_id in valid_quest_ids]
            for quest_id in quest_ids:
                if quest_id in covered_quest_ids:
                    continue
                covered_quest_ids.add(quest_id)

                qdata = questdata_map.get(quest_id, {})
                quest_type = qdata.get("Type", 0)
                tid_name = qdata.get("TidName", "")
                quest_name = _display_name(tid_name) if tid_name else ""
                quest_name = quest_name or f"Quest_{quest_id}"

                base_flows = get_quest_flows(quest_id, qnode_cur)
                flows = _expand_to_all_flowids(base_flows, fl_fids)

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

                if not all_lines or not has_available_dialogue(all_lines):
                    continue

                renumber_lines_globally(all_lines)

                quest_idx += 1
                q_dir = os.path.join(ch_dir, sanitize_filename(f"{quest_idx:03d}_{quest_name}"))
                safe_makedirs(q_dir)

                chapter_lines += len(all_lines)
                chapter_total_lines += len(all_lines)

                output = {
                    "chapter_id": ch_id,
                    "chapter_name": ch_name,
                    "node_id": node.node_id,
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
            try:
                os.rmdir(ch_dir)
            except OSError:
                pass

    # Export side quests not in QuestTree
    uncovered = [qid for qid in questdata_map if qid not in covered_quest_ids]
    side_dir = os.path.join(QUEST_OUTPUT_DIR, "side_quests")
    side_count = 0

    for quest_id in sorted(uncovered):
        qdata = questdata_map.get(quest_id, {})
        quest_type = qdata.get("Type", 0)

        if quest_type == 1 or quest_type not in visible_quest_type_ids:
            continue

        tid_name = qdata.get("TidName", "")
        quest_name = _display_name(tid_name) if tid_name else ""
        quest_name = quest_name or f"Quest_{quest_id}"

        base_flows = get_quest_flows(quest_id, qnode_cur)
        flows = _expand_to_all_flowids(base_flows, fl_fids)
        if not flows:
            continue

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

        if not all_lines or not has_available_dialogue(all_lines):
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

    print(f"Quest Dialogue Export complete. Chapters Dialogue Lines: {chapter_total_lines}, Side Quests: {side_count}")
    
    # Close resources used for dialogue
    db_tree.close()
    db_qdata.close()
    db_qtype.close()
    db_qnode.close()
    db_fstate.close()

    # -----------------------------------------------------------------------
    # Part 2: Database-Driven Text Grouping (Categories)
    # -----------------------------------------------------------------------
    print("\n[PART 2] Running Grouped Categories Text Export...")
    
    # Load all languages lang packs
    print("Loading all texts for active languages...")
    for pack in lang_packs:
        pack.load()
        print(f"  Loaded {len(pack._texts)} keys for language: {pack.lang}")

    # Build unique set of all keys across languages
    all_keys = set()
    for pack in lang_packs:
        all_keys.update(pack._texts.keys())
        
    print(f"Total unique keys across all language packs: {len(all_keys)}")
    
    # Build database-driven category map
    key_to_db_category = build_tid_to_db_map(all_keys)

    # Group all keys into categories
    grouped_keys: dict[str, dict[str, dict[str, str]]] = {} # category -> key -> lang -> content
    
    dialogue_exclusions_count = 0
    fallback_categories_count = 0
    db_categories_count = 0

    for key in sorted(all_keys):
        # Apply Dialogue Exclusion
        if key in exported_dialogue_keys:
            dialogue_exclusions_count += 1
            continue

        # Determine Category
        category = key_to_db_category.get(key)
        
        if category:
            db_categories_count += 1
        else:
            # Fallback to Prefix
            prefix = key.split('_')[0] if '_' in key else "NoPrefix"
            category = PREFIX_FALLBACK_CATEGORIES.get(prefix, prefix)
            fallback_categories_count += 1

        # Retrieve translations
        translations = {}
        for pack in lang_packs:
            content = pack.get_text(key)
            if content:
                translations[pack.lang] = content

        if not translations:
            continue

        grouped_keys.setdefault(category, {})[key] = translations

    print(f"  Dialogue Keys Excluded: {dialogue_exclusions_count}")
    print(f"  Keys Mapped via DB Scan: {db_categories_count}")
    print(f"  Keys Mapped via Fallback Prefix: {fallback_categories_count}")

    # Save to categories files
    # Clean up minor groups and merge into others.json if count < 50 keys
    major_groups: dict[str, dict] = {}
    others_group: dict[str, dict] = {}

    for cat, keys_dict in grouped_keys.items():
        if len(keys_dict) >= 50:
            major_groups[cat] = keys_dict
        else:
            # Merge small ones into others
            for k, val in keys_dict.items():
                others_group[k] = val

    # Save major groups
    for cat, keys_dict in sorted(major_groups.items()):
        out_file = os.path.join(CATEGORIES_OUTPUT_DIR, f"{cat}.json")
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(keys_dict, f, ensure_ascii=False, indent=2)
        print(f"  Saved category file: {cat}.json ({len(keys_dict)} entries)")

    # Save others group
    if others_group:
        out_file = os.path.join(CATEGORIES_OUTPUT_DIR, "others.json")
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(others_group, f, ensure_ascii=False, indent=2)
        print(f"  Saved category file: others.json ({len(others_group)} entries)")

    print(f"\n{'='*60}")
    print("Grouped Text Export Complete!")
    print(f"  Output folder: {OUTPUT_DIR}")
    print(f"  Subdirectories:")
    print(f"    - Quest dialogue: {QUEST_OUTPUT_DIR}")
    print(f"    - Category JSONs: {CATEGORIES_OUTPUT_DIR}")
    print(f"  Total Category files created: {len(major_groups) + (1 if others_group else 0)}")
    print(f"=" * 60)


if __name__ == "__main__":
    main()
