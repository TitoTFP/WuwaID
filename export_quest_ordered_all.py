#!/usr/bin/env python3
"""
export_quest_raw_all.py

Raw-ish exporter for Wuthering Waves quest dialogue/config references.

Compared to export_quest_ordered.py, this script intentionally DOES NOT skip:
- hidden placeholder chapters
- hidden / non-panel quest types
- Type=1 quests not covered by QuestTree
- quests with no flows
- quests with flows but no dialogue
- masked/unavailable dialogue

It exports every quest found in db_QuestData.db into one JSONL file and one JSON
file per quest, while still reusing the parsing/dialogue extraction helpers from
export_quest_ordered.py.

Expected folder structure when run:
  WuwaDBExport/
    ConfigDB -> .        # symlink is OK
    base/db_QuestData.db
    base/db_QuestNodeData.db
    base/db_flowState.db
    base/db_QuestTree.db
    zh-Hans/lang_multi_text.db
    en/lang_multi_text.db
    ja/lang_multi_text.db

Usage from WuwaDBExport:
  ln -sfn . ConfigDB
  python /home/nozomi/Documents/Repos/WuwaID/export_quest_raw_all.py

Optional env vars:
  CONFIG_DB_DIR=ConfigDB
  OUTPUT_DIR=export_quest_raw_all
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
from pathlib import Path

# Import helper functions/classes from the original script.
# Put this file in the same repo folder as export_quest_ordered.py, or adjust PYTHONPATH.
import export_quest_ordered as oq


CONFIG_DB_DIR = os.environ.get("CONFIG_DB_DIR", "ConfigDB")
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "export_quest_raw_all"))
LANGUAGES = ["zh-Hans", "en", "ja"]


# Patch the original module's CONFIG_DB_DIR so all reused helpers open the right DB path.
oq.CONFIG_DB_DIR = CONFIG_DB_DIR


def safe_name(name: str, max_len: int = 100) -> str:
    return oq.sanitize_filename(name or "unnamed", max_len=max_len)


def open_db_first_existing(*rel_paths: str) -> sqlite3.Connection:
    for rel in rel_paths:
        p = Path(CONFIG_DB_DIR) / rel
        if p.is_file():
            return sqlite3.connect(p)
    raise FileNotFoundError("None found: " + ", ".join(str(Path(CONFIG_DB_DIR) / p) for p in rel_paths))


def open_db(rel_path: str) -> sqlite3.Connection:
    p = Path(CONFIG_DB_DIR) / rel_path
    if not p.is_file():
        raise FileNotFoundError(str(p))
    return sqlite3.connect(p)


def load_questdata(qdata_cur: sqlite3.Cursor) -> dict[int, dict]:
    qdata_cur.execute("SELECT QuestId, BinData FROM questdata ORDER BY QuestId")
    out: dict[int, dict] = {}
    for qid, bindata in qdata_cur.fetchall():
        obj = oq.extract_json_from_bindata(bindata)
        out[int(qid)] = obj if isinstance(obj, dict) else {}
    return out


def load_quest_types(qtype_cur: sqlite3.Cursor) -> dict[int, dict]:
    out: dict[int, dict] = {}
    try:
        qtype_cur.execute("SELECT Id, BinData FROM QuestType ORDER BY Id")
        for qtype_id, bindata in qtype_cur.fetchall():
            decoded = oq.decode_questtype(bindata)
            if decoded:
                out[int(qtype_id)] = {
                    "quest_type_id": decoded.quest_type_id,
                    "main_type_id": decoded.main_type_id,
                    "name_key": decoded.name_key,
                    "is_show_in_panel": decoded.is_show_in_panel,
                }
    except Exception as e:
        print(f"Warning: failed to load quest types: {e}")
    return out


def load_chapters_and_nodes(tree_cur: sqlite3.Cursor, lang_zh: oq.LangPack) -> tuple[dict[int, dict], dict[int, list[dict]]]:
    """Return:
    chapters: chapter_id -> metadata
    quest_tree_refs: quest_id -> list of node/chapter references
    """
    chapters: dict[int, dict] = {}
    quest_tree_refs: dict[int, list[dict]] = {}

    try:
        tree_cur.execute("SELECT Id, BinData FROM questtreechapter ORDER BY Id")
        for row_id, bindata in tree_cur.fetchall():
            chapter = oq.decode_questtree_chapter(bindata)
            if not chapter:
                continue
            chapter_name = lang_zh.get_text(chapter.name_key) if chapter.name_key else ""
            chapters[chapter.chapter_id] = {
                "row_id": row_id,
                "chapter_id": chapter.chapter_id,
                "name_key": chapter.name_key,
                "chapter_name_zh-Hans": chapter_name or chapter.name_key or f"Chapter_{chapter.chapter_id}",
                "is_hidden_placeholder_key": chapter.name_key in oq.HIDDEN_CHAPTER_KEYS,
            }
    except Exception as e:
        print(f"Warning: failed to load chapters: {e}")

    try:
        tree_cur.execute("SELECT Id, ChapterId, BinData FROM questtreenode ORDER BY ChapterId, Id")
        for row_id, chapter_id_col, bindata in tree_cur.fetchall():
            node = oq.decode_questtree_node(bindata)
            if not node:
                continue

            ref = {
                "row_id": row_id,
                "node_id": node.node_id,
                "chapter_id": node.chapter_id,
                "chapter_id_column": chapter_id_col,
                "quest_type_from_tree": node.quest_type,
                "node_type": node.node_type,
                "pre_nodes": node.pre_nodes,
                "next_node": node.next_node,
                "sort_order": node.sort_order,
                "is_chapter_ending": node.is_chapter_ending,
            }
            for qid in node.quest_ids:
                quest_tree_refs.setdefault(int(qid), []).append(ref)
    except Exception as e:
        print(f"Warning: failed to load quest tree refs: {e}")

    return chapters, quest_tree_refs


def build_flowstate_index(fstate_cur: sqlite3.Cursor) -> dict[tuple[str, int], list[tuple[str, int, bytes]]]:
    fstate_cur.execute("SELECT StateKey, BinData FROM flowstate ORDER BY StateKey")
    all_states = fstate_cur.fetchall()
    state_index: dict[tuple[str, int], list[tuple[str, int, bytes]]] = {}

    unparsed = 0
    for state_key, bindata in all_states:
        parsed = oq.parse_flowstate_key(state_key)
        if not parsed:
            unparsed += 1
            continue
        list_name, state_id, sub_id = parsed
        state_index.setdefault((list_name, state_id), []).append((state_key, sub_id, bindata))

    print(f"Loaded {len(all_states)} flowstate rows")
    print(f"Indexed {len(state_index)} flow list/state combinations")
    print(f"Unparsed flowstate keys: {unparsed}")
    return state_index


def extract_quest_dialogue(
    quest_id: int,
    qnode_cur: sqlite3.Cursor,
    state_index: dict[tuple[str, int], list[tuple[str, int, bytes]]],
    lang_packs: list[oq.LangPack],
) -> tuple[list[tuple[str, int]], list[dict], list[dict], list[dict]]:
    flows = oq.get_quest_flows(quest_id, qnode_cur)
    flow_details: list[dict] = []
    all_lines: list[dict] = []
    missing_flowstate: list[dict] = []

    for flow_name, state_id in flows:
        entries = state_index.get((flow_name, state_id), [])
        flow_lines: list[dict] = []

        if not entries:
            missing_flowstate.append({"flow_list_name": flow_name, "flow_id": state_id})

        for state_key, sub_id, bindata in sorted(entries, key=lambda x: (x[1], x[0])):
            lines = oq.extract_dialogue_from_flowstate(state_key, bindata, lang_packs)
            flow_lines.extend(lines)

        flow_details.append({
            "flow_list_name": flow_name,
            "flow_id": state_id,
            "state_id": state_id,
            "matched_flowstate_entries": len(entries),
            "dialogue_line_count": len(flow_lines),
            "dialogue": flow_lines,
        })
        all_lines.extend(flow_lines)

    return flows, flow_details, all_lines, missing_flowstate


def main() -> None:
    print("=" * 70)
    print("  Wuthering Waves RAW All Quest Exporter")
    print("=" * 70)
    print(f"CONFIG_DB_DIR: {CONFIG_DB_DIR}")
    print(f"OUTPUT_DIR:    {OUTPUT_DIR.resolve()}")

    if not Path(CONFIG_DB_DIR).exists():
        raise FileNotFoundError(f"CONFIG_DB_DIR does not exist: {CONFIG_DB_DIR}")

    # Open databases.
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

    lang_packs = [oq.LangPack(lang) for lang in LANGUAGES]
    lang_zh = lang_packs[0]

    print("Loading questdata...")
    questdata_map = load_questdata(qdata_cur)
    print(f"Loaded {len(questdata_map)} questdata entries")

    print("Loading quest types...")
    quest_types = load_quest_types(qtype_cur)
    print(f"Loaded {len(quest_types)} quest types")

    print("Loading quest tree refs...")
    chapters, quest_tree_refs = load_chapters_and_nodes(tree_cur, lang_zh)
    print(f"Loaded {len(chapters)} chapters")
    print(f"Quests referenced by quest tree: {len(quest_tree_refs)}")

    print("Loading flowstate index...")
    state_index = build_flowstate_index(fstate_cur)

    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    per_quest_dir = OUTPUT_DIR / "quests"
    per_quest_dir.mkdir(parents=True, exist_ok=True)

    summary_path = OUTPUT_DIR / "all_quests_raw.jsonl"
    index_path = OUTPUT_DIR / "index.json"

    exported = 0
    total_lines = 0
    no_flows = 0
    no_dialogue = 0
    missing_flow_refs = 0

    with summary_path.open("w", encoding="utf-8") as jf:
        for idx, quest_id in enumerate(sorted(questdata_map.keys()), start=1):
            qdata = questdata_map.get(quest_id, {})
            quest_type = int(qdata.get("Type", 0) or 0)
            tid_name = qdata.get("TidName", "") or ""

            quest_name_by_lang = {}
            for pack in lang_packs:
                quest_name_by_lang[pack.lang] = pack.get_text(tid_name) if tid_name else ""

            quest_name_zh = quest_name_by_lang.get("zh-Hans") or f"Quest_{quest_id}"

            flows, flow_details, all_lines, missing_flowstate = extract_quest_dialogue(
                quest_id, qnode_cur, state_index, lang_packs
            )

            refs = quest_tree_refs.get(quest_id, [])
            chapter_infos = []
            for ref in refs:
                ch = chapters.get(ref.get("chapter_id"), {})
                chapter_infos.append({**ref, "chapter": ch})

            qtype_info = quest_types.get(quest_type, {})

            record = {
                "quest_id": quest_id,
                "quest_name": quest_name_by_lang,
                "quest_name_key": tid_name,
                "quest_type": quest_type,
                "quest_type_info": qtype_info,
                "raw_questdata": qdata,
                "quest_tree_refs": chapter_infos,
                "is_in_quest_tree": bool(refs),
                "flows_count": len(flows),
                "flows": flow_details,
                "missing_flowstate_refs": missing_flowstate,
                "total_lines": len(all_lines),
                "has_available_dialogue_zh-Hans": oq.has_available_dialogue(all_lines),
                "all_lines": all_lines,
            }

            if not flows:
                no_flows += 1
            if not all_lines:
                no_dialogue += 1
            if missing_flowstate:
                missing_flow_refs += 1

            total_lines += len(all_lines)
            exported += 1

            # Per quest file.
            qdir_name = safe_name(f"{quest_id}_{quest_name_zh}")
            qdir = per_quest_dir / qdir_name
            qdir.mkdir(parents=True, exist_ok=True)
            (qdir / "quest_raw.json").write_text(
                json.dumps(record, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            # JSONL summary includes full record too; useful for grep/jq pipelines.
            jf.write(json.dumps(record, ensure_ascii=False) + "\n")

            if idx % 100 == 0:
                print(f"  processed {idx}/{len(questdata_map)} quests...")

    index = {
        "config_db_dir": CONFIG_DB_DIR,
        "output_dir": str(OUTPUT_DIR.resolve()),
        "languages": LANGUAGES,
        "quests_exported": exported,
        "total_dialogue_lines": total_lines,
        "quests_with_no_flows": no_flows,
        "quests_with_no_dialogue": no_dialogue,
        "quests_with_missing_flowstate_refs": missing_flow_refs,
        "notes": [
            "This raw exporter intentionally includes hidden/non-panel quests.",
            "It also includes quests with no flows and no dialogue.",
            "Non-ShowTalk actions are still not expanded; flow details contain extracted ShowTalk dialogue only.",
        ],
    }
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=" * 70)
    print("RAW export complete")
    print(f"Output: {OUTPUT_DIR.resolve()}")
    print(f"Quests exported: {exported}")
    print(f"Total dialogue lines: {total_lines}")
    print(f"No flows: {no_flows}")
    print(f"No dialogue: {no_dialogue}")
    print(f"Missing flowstate refs: {missing_flow_refs}")
    print(f"JSONL: {summary_path}")
    print(f"Index: {index_path}")
    print("=" * 70)

    db_tree.close()
    db_qdata.close()
    db_qtype.close()
    db_qnode.close()
    db_fstate.close()


if __name__ == "__main__":
    main()
