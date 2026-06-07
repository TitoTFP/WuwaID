"""Compose all translation modules to process one quest end-to-end."""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any

from .client import LlamaClient
from .glossary import terms_for_state
from .memory import Memory
from .postprocess import detect_violations, find_missing_terms
from .progress import (
    ProgressReporter,
    is_state_complete,
    load_existing_output,
    write_quest_output,
)
from .prompt import (
    build_system_prompt,
    build_user_prompt,
    build_augmented_system_prompt,
    parse_translation_response,
    THINK_TOKEN,
)
from .state_iter import group_lines_by_state
from .usage import Usage
from tqdm.contrib.logging import logging_redirect_tqdm

log = logging.getLogger(__name__)


async def translate_quest(
    quest_path: Path,
    quest_data: dict,
    output_dir: Path,
    memory: Memory,
    glossary: dict,
    client: LlamaClient,
    concurrency: int = 4,
    glossary_categories: dict[str, str] | None = None,
    use_cache: bool = True,
    force: bool = False,
    enable_thinking: bool = True,
    progress: ProgressReporter | None = None,
    flush_every: int = 0,
    model: str = "",
) -> dict:
    """Translate one quest. Returns stats dict.

    `memory` is mutated in place (write-once inserts from new translations).
    `output_dir/<qid>.json` is written atomically at the end.
    `enable_thinking` toggles the Gemma 4 `<|think|>` token in the system prompt.
    `progress`, if given, is notified at quest_start, state_done, and quest_done.
    `flush_every` controls intermediate disk flushes: 0 = end-of-quest only
    (default), N>0 = flush both <qid>.json and memory after every N states.
    `model` is stored in the memory file when an intermediate flush occurs.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    qid = int(quest_data.get("quest_id", 0))
    output_path = output_dir / f"{qid}.json"

    # Load existing output (for skip-resume) — skip when --force
    if force:
        existing = {}
    else:
        existing = load_existing_output(output_path) if output_path.exists() else {}
    output_payload: dict[str, Any] = {
        "quest_id": qid,
        "quest_name": quest_data.get("quest_name", ""),
        "chapter_id": quest_data.get("chapter_id", 0),
        "chapter_name": quest_data.get("chapter_name", ""),
        "translated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": memory.model or "",
        "states": existing,  # start with what's there; we'll overwrite translated states
    }

    # Group lines by state, preserving order
    by_state = group_lines_by_state(quest_data.get("all_lines", []) or [])

    # Determine which states to skip
    todo: list[tuple[str, list[dict]]] = []
    for sk, lines in by_state.items():
        if sk in existing and is_state_complete(existing[sk], source_line_count=len(lines)):
            log.info("qid %s state %s: already complete, skipping", qid, sk)
            continue
        todo.append((sk, lines))

    if progress is not None:
        progress.quest_start(
            qid=qid,
            quest_name=quest_data.get("quest_name", ""),
            total_states=len(todo),
        )

    stats = {
        "states_done": 0,
        "states_skipped": len(by_state) - len(todo),
        "lines_translated": 0,
        "lines_from_memory": 0,
        "errors": 0,
        "violations": 0,
    }

    # Process states concurrently up to `concurrency`
    sem = asyncio.Semaphore(concurrency)

    async def run_one(state_key: str, lines: list[dict]) -> tuple[str, dict]:
        async with sem:
            return state_key, await _translate_state(
                quest_data=quest_data,
                state_key=state_key,
                lines=lines,
                glossary=glossary,
                glossary_categories=glossary_categories,
                memory=memory,
                client=client,
                use_cache=use_cache,
                enable_thinking=enable_thinking,
                progress=progress,
            )

    tasks = [run_one(sk, ls) for sk, ls in todo]
    # logging_redirect_tqdm routes log.info/warn calls through tqdm.write,
    # which clears and redraws the bar so the per-state log line does not
    # break tqdm's cursor and freeze the progress display.
    with logging_redirect_tqdm():
        done_count = 0
        for coro in asyncio.as_completed(tasks):
            state_key, result = await coro
            output_payload["states"][state_key] = result
            if "error" in result:
                stats["errors"] += 1
            else:
                stats["states_done"] += 1
                for line in result.get("lines", []):
                    if line.get("from_memory"):
                        stats["lines_from_memory"] += 1
                    else:
                        stats["lines_translated"] += 1
                    if "glossary_violation" in (line.get("flags") or []):
                        stats["violations"] += 1
            done_count += 1
            # Intermediate flush: write quest output + memory to disk so a
            # crash mid-quest loses at most N states of work. Final write
            # still happens below (ensures last N states are persisted even
            # when N doesn't divide total_states evenly).
            if flush_every > 0 and done_count % flush_every == 0:
                write_quest_output(output_path, output_payload)
                if use_cache:
                    memory.save(model=model)

    # Atomic write per-quest output (final; always runs)
    write_quest_output(output_path, output_payload)
    if progress is not None:
        progress.quest_done()
    return stats


async def _translate_state(
    quest_data: dict,
    state_key: str,
    lines: list[dict],
    glossary: dict,
    glossary_categories: dict[str, str] | None,
    memory: Memory,
    client: LlamaClient,
    use_cache: bool,
    enable_thinking: bool = True,
    progress: ProgressReporter | None = None,
) -> dict:
    """Translate one state. Returns the state payload (lines or error)."""
    plot_mode = ""
    flow_name = ""
    for flow in (quest_data.get("flows") or []):
        for st in (flow.get("states") or []):
            if st.get("state_key") == state_key:
                plot_mode = st.get("plot_mode", "")
                flow_name = flow.get("flow_name", "") or flow.get("name", "")
                break
        if plot_mode:
            break

    state_context = {
        "quest_id": quest_data.get("quest_id"),
        "quest_name": quest_data.get("quest_name", ""),
        "chapter_id": quest_data.get("chapter_id", 0),
        "chapter_name": quest_data.get("chapter_name", ""),
        "flow_name": "",  # could be filled in by caller; not required for translation
        "state_key": state_key,
        "plot_mode": plot_mode,
    }

    state_glossary = terms_for_state(glossary, lines)
    expected_ids = [l["id"] for l in lines]

    output_lines: list[dict] = []
    lines_to_llm: list[dict] = []
    llm_line_index: list[int] = []  # positions in output_lines that need LLM result

    # First pass: serve from cache
    for i, line in enumerate(lines):
        text_en = line.get("text_en", "") or ""
        if not text_en.strip():
            # Empty source: passthrough, no LLM call, line still in output
            # so line count matches source for skip detection.
            out_line = dict(line)
            out_line["speaker_id"] = ""
            out_line["text_id"] = ""
            out_line["from_memory"] = False
            out_line["flags"] = []
            out_line["source_text_en"] = ""
            out_line["source_speaker_en"] = ""
            output_lines.append(out_line)
            continue
        tk = line.get("text_key", "")
        if use_cache and tk:
            check = memory.lookup_with_check(
                tk,
                current_text_en=line.get("text_en", ""),
                current_speaker_en=line.get("speaker_en", ""),
            )
            if check is not None:
                entry, mismatches = check
                if mismatches:
                    log.warning(
                        "qid %s text_key %s hit cache but %s differs (cached=%r, current=%r). Using cache; consider --no-cache.",
                        quest_data.get("quest_id"), tk, mismatches,
                        entry.get("source_text_en"), line.get("text_en"),
                    )
                # Cache hit
                out_line = dict(line)
                out_line["text_id"] = entry["text_id"]
                # Speaker: re-resolve via glossary on this line's speaker_en
                out_line["speaker_id"] = _resolve_speaker(line.get("speaker_en", ""), glossary)
                out_line["from_memory"] = True
                out_line["flags"] = []
                out_line["source_text_en"] = entry.get("source_text_en", "")
                out_line["source_speaker_en"] = entry.get("source_speaker_en", "")
                output_lines.append(out_line)
                continue
        # Cache miss — needs LLM
        output_lines.append({})  # placeholder
        llm_line_index.append(i)
        lines_to_llm.append(line)

    if not lines_to_llm:
        # All lines served from memory
        if progress is not None:
            progress.state_done(state_key=state_key, usage=Usage(), from_memory=True, flow_name=flow_name)
        return {"plot_mode": plot_mode, "lines": output_lines}

    # LLM translate the lines that need it
    user_prompt = build_user_prompt(
        glossary_subset=state_glossary,
        glossary_categories=glossary_categories,
        state_context=state_context,
        lines=lines_to_llm,
    )
    expected_llm_ids = [l["id"] for l in lines_to_llm]

    try:
        llm_result = await _llm_translate_with_glossary_retry(
            state_glossary=state_glossary,
            user_prompt=user_prompt,
            expected_ids=expected_llm_ids,
            client=client,
            output_lines_template=lines_to_llm,
            enable_thinking=enable_thinking,
        )
    except Exception as e:
        log.error("qid %s state %s translation failed: %s", quest_data.get("quest_id"), state_key, e)
        if progress is not None:
            progress.state_done(state_key=state_key, usage=Usage(), from_memory=False, flow_name=flow_name)
        return {"error": str(e)[:300]}

    llm_lines = llm_result.lines

    # Fill in the LLM results
    for pos, llm_line in zip(llm_line_index, llm_lines):
        source_line = lines[pos]
        out_line = dict(source_line)
        out_line["speaker_id"] = llm_line.get("speaker_id", "")
        out_line["text_id"] = llm_line.get("text_id", "")
        out_line["from_memory"] = False
        out_line["flags"] = []
        out_line["source_text_en"] = source_line.get("text_en", "")
        out_line["source_speaker_en"] = source_line.get("speaker_en", "")
        # Insert into memory (write-once)
        tk = source_line.get("text_key", "")
        if tk:
            memory.insert(
                text_key=tk,
                text_id=out_line["text_id"],
                source_text_en=out_line["source_text_en"],
                source_speaker_en=out_line["source_speaker_en"],
                from_quest=int(quest_data.get("quest_id", 0)),
            )
        output_lines[pos] = out_line

    # Post-translation: detect violations on the lines that went through the LLM
    # and tag them. (Cache hits already passed the violation check at lookup
    # time, so they're clean.)
    for line in output_lines:
        if not line or line.get("from_memory"):
            continue
        viols = detect_violations(line, state_glossary)
        if viols:
            line["flags"] = ["glossary_violation"]
            log.warning("qid %s state %s line %s: glossary violations %s", quest_data.get("quest_id"), state_key, line.get("id"), viols)

    if progress is not None:
        progress.state_done(
            state_key=state_key,
            usage=llm_result.usage,
            from_memory=False,
            flow_name=flow_name,
        )
    log.info(
        "qid %s flow=%r state=%s: prompt=%d completion=%d reasoning=%d",
        quest_data.get("quest_id"), flow_name, state_key,
        llm_result.usage.prompt_tokens, llm_result.usage.completion_tokens,
        llm_result.usage.reasoning_tokens,
    )

    return {"plot_mode": plot_mode, "lines": output_lines}


async def _llm_translate_with_glossary_retry(
    state_glossary: list[str],
    user_prompt: str,
    expected_ids: list[int],
    client: LlamaClient,
    output_lines_template: list[dict],
    enable_thinking: bool = True,
) -> "StateTranslation":
    """Translate + check glossary, retry once with augmented prompt if needed.

    Returns a StateTranslation with the final list of {line_id, speaker_id, text_id}
    and the total token usage (summed across all LLM calls for this state).
    """
    from .client import StateTranslation
    base_system = build_system_prompt(enable_thinking=enable_thinking)
    result = await client.translate_state(base_system, user_prompt, expected_ids)
    llm_lines = result.lines
    total_usage = result.usage

    # Build a "line record" for the postprocessor
    records = []
    for src, llm in zip(output_lines_template, llm_lines):
        records.append({
            "speaker_en": src.get("speaker_en", ""),
            "text_en": src.get("text_en", ""),
            "speaker_id": llm.get("speaker_id", ""),
            "text_id": llm.get("text_id", ""),
        })

    if not state_glossary:
        return StateTranslation(lines=llm_lines, usage=total_usage)

    missing = find_missing_terms(records, state_glossary)
    if not missing:
        return StateTranslation(lines=llm_lines, usage=total_usage)

    log.info("glossary violation: %d terms missing, retrying", len(missing))
    aug_system = build_augmented_system_prompt(missing)
    # Augmented system still includes the think token if enabled.
    if enable_thinking and THINK_TOKEN not in aug_system:
        aug_system = aug_system + "\n" + THINK_TOKEN
    result = await client.translate_state(aug_system, user_prompt, expected_ids)
    return StateTranslation(lines=result.lines, usage=total_usage + result.usage)


def _resolve_speaker(speaker_en: str, glossary: dict) -> str:
    """Apply glossary: if speaker_en has a canonical Indonesian name, use it;
    otherwise return speaker_en unchanged."""
    if not speaker_en:
        return ""
    entry = glossary.get(speaker_en)
    if not entry:
        return speaker_en
    id_form = entry.get("indonesian_translation", "") or ""
    if not id_form or id_form == speaker_en:
        return speaker_en
    return id_form
