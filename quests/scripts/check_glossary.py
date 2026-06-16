import json
import re
from pathlib import Path

def main():
    repo_root = Path(".")
    data_dir = repo_root / "data"
    glossary_path = data_dir / "glossary.json"
    
    if not glossary_path.is_file():
        print(f"Glossary file not found at {glossary_path}")
        return
        
    glossary = json.loads(glossary_path.read_text(encoding="utf-8"))
    
    # Filter glossary to active terms
    glossary_active = {}
    for en, val in glossary.items():
        id_trans = val.get("indonesian_translation", "").strip()
        if id_trans:
            glossary_active[en] = id_trans
            
    print(f"Loaded {len(glossary_active)} active glossary terms.")
    
    # Build term starting word index
    STOP_WORDS = {"a", "an", "the", "of", "to", "in", "for", "on", "with", "at", "by", "from"}
    start_word_map = {}
    term_info = {} # en_term -> (id_term, pattern)
    
    for en, id_trans in glossary_active.items():
        if len(en) < 3:
            continue
        try:
            pattern = re.compile(r"\b" + re.escape(en) + r"\b", re.IGNORECASE)
            term_info[en] = (id_trans, pattern)
            
            words = re.findall(r'\b\w+\b', en.lower())
            if words:
                start_word = words[0]
                for w in words:
                    if w not in STOP_WORDS and len(w) >= 3:
                        start_word = w
                        break
                start_word_map.setdefault(start_word, []).append(en)
        except Exception:
            pass
            
    def get_matching_terms(text_en):
        if not text_en:
            return []
        words_in_text = set(re.findall(r'\b\w+\b', text_en.lower()))
        candidates = set()
        for w in words_in_text:
            if w in start_word_map:
                candidates.update(start_word_map[w])
        
        matches = []
        for en_term in candidates:
            id_term, pattern = term_info[en_term]
            if pattern.search(text_en):
                matches.append((en_term, id_term))
        return matches
        
    # 1. Check Speakers in categories_id/Speaker.json
    print("\n--- Checking Speakers Category ---")
    speaker_base_path = data_dir / "categories" / "Speaker.json"
    speaker_id_path = data_dir / "categories_id" / "Speaker.json"
    
    if speaker_base_path.is_file() and speaker_id_path.is_file():
        try:
            spk_base = json.loads(speaker_base_path.read_text(encoding="utf-8"))
            spk_id = json.loads(speaker_id_path.read_text(encoding="utf-8"))
            
            for key, val in spk_base.items():
                if not isinstance(val, dict):
                    continue
                en_name = val.get("en", "")
                if en_name in glossary_active:
                    expected_id = glossary_active[en_name]
                    actual_id_data = spk_id.get(key)
                    actual_id = ""
                    if isinstance(actual_id_data, dict):
                        actual_id = actual_id_data.get("id", "").strip()
                    elif isinstance(actual_id_data, str):
                        actual_id = actual_id_data.strip()
                        
                    if actual_id and actual_id != expected_id:
                        print(f"[Speaker Dev] Key: {key} | EN: '{en_name}' | Expected ID: '{expected_id}' | Actual ID: '{actual_id}'")
        except Exception as e:
            print(f"Error checking Speaker category: {e}")
            
    # 2. Check other Categories
    print("\n--- Checking Category Files ---")
    categories_dir = data_dir / "categories"
    categories_id_dir = data_dir / "categories_id"
    
    for p in categories_dir.glob("*.json"):
        if p.name == "Speaker.json" or p.name.startswith("_"):
            continue
        id_path = categories_id_dir / p.name
        if not id_path.is_file():
            continue
            
        try:
            cat_base = json.loads(p.read_text(encoding="utf-8"))
            cat_id = json.loads(id_path.read_text(encoding="utf-8"))
            
            for key, val in cat_base.items():
                # Get English text
                text_en = ""
                if isinstance(val, dict):
                    text_en = val.get("en", "")
                elif isinstance(val, str):
                    text_en = val
                if not text_en:
                    continue
                    
                # Get Indonesian translation
                actual_id = ""
                val_id = cat_id.get(key)
                if isinstance(val_id, dict):
                    actual_id = val_id.get("id", "").strip()
                elif isinstance(val_id, str):
                    actual_id = val_id.strip()
                if not actual_id:
                    continue
                    
                # Check 2a: Exact match against glossary
                if text_en in glossary_active:
                    expected_id = glossary_active[text_en]
                    if actual_id != expected_id:
                        print(f"[{p.name} Exact Dev] Key: {key} | EN: '{text_en}' | Expected ID: '{expected_id}' | Actual ID: '{actual_id}'")
                        continue
                        
                # Check 2b: Substring / Term matching
                matches = get_matching_terms(text_en)
                for en_term, id_term in matches:
                    if id_term.lower() not in actual_id.lower():
                        if en_term.lower() != id_term.lower():
                            print(f"[{p.name} Term Dev] Key: {key} | EN sentence: '{text_en}' | Contains term: '{en_term}' -> '{id_term}' | Actual ID: '{actual_id}'")
        except Exception as e:
            print(f"Error checking category {p.name}: {e}")
            
    # 3. Check Quest Dialogues
    print("\n--- Checking Quests ---")
    quests_dir = data_dir / "quests"
    quests_id_dir = data_dir / "quests_id"
    
    for p in quests_dir.glob("*.json"):
        id_path = quests_id_dir / p.name
        if not id_path.is_file():
            continue
            
        try:
            q_base = json.loads(p.read_text(encoding="utf-8"))
            q_id = json.loads(id_path.read_text(encoding="utf-8"))
            
            # Map quest_id lines
            id_lines = {}
            for state in (q_id.get("states") or {}).values():
                for entry in (state.get("lines") or []):
                    lid = entry.get("id")
                    if lid is not None:
                        id_lines[lid] = entry
                        
            all_lines = q_base.get("all_lines") or []
            for line in all_lines:
                lid = line.get("id")
                if lid not in id_lines:
                    continue
                line_id_data = id_lines[lid]
                
                # Check 3a: Speaker name
                speaker_en = line.get("speaker_en", "")
                speaker_id = line_id_data.get("speaker_id", "").strip()
                if speaker_en in glossary_active:
                    expected_spk_id = glossary_active[speaker_en]
                    if speaker_id and speaker_id != expected_spk_id:
                        print(f"[Quest {p.name} Speaker Dev] Line ID: {lid} | EN Speaker: '{speaker_en}' | Expected ID: '{expected_spk_id}' | Actual ID: '{speaker_id}'")
                        
                # Check 3b: Line text terms
                text_en = line.get("text_en", "")
                text_id = line_id_data.get("text_id", "").strip()
                
                if text_id:
                    matches = get_matching_terms(text_en)
                    for en_term, id_term in matches:
                        if id_term.lower() not in text_id.lower():
                            if en_term.lower() != id_term.lower():
                                print(f"[Quest {p.name} Text Dev] Line ID: {lid} | EN text: '{text_en}' | Contains term: '{en_term}' -> '{id_term}' | Actual ID: '{text_id}'")
                                    
                # Check 3c: Options terms
                options = line.get("options") or []
                id_options = {o.get("text_key"): o.get("text_id", "") for o in line_id_data.get("options", []) if o.get("text_key")}
                for opt in options:
                    opt_tk = opt.get("text_key")
                    opt_text_en = opt.get("text_en", "")
                    opt_text_id = id_options.get(opt_tk, "").strip()
                    
                    if opt_text_id:
                        matches = get_matching_terms(opt_text_en)
                        for en_term, id_term in matches:
                            if id_term.lower() not in opt_text_id.lower():
                                if en_term.lower() != id_term.lower():
                                    print(f"[Quest {p.name} Option Dev] Line ID: {lid} | EN opt: '{opt_text_en}' | Contains term: '{en_term}' -> '{id_term}' | Actual ID: '{opt_text_id}'")
        except Exception as e:
            print(f"Error checking quest {p.name}: {e}")

if __name__ == "__main__":
    main()
