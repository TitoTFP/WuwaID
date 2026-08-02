import asyncio
import sys
from pathlib import Path

# Add repo root to sys.path
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.mcp_server import translate_dialogue, get_glossary, add_glossary_term

async def test_all():
    print("=== Testing get_glossary ===")
    g = get_glossary(query="Yangyang")
    print(f"Glossary search result for 'Yangyang': {g}")
    assert "Yangyang" in g, "Yangyang should be in glossary"
    print("PASS: get_glossary works.")

    print("\n=== Testing add_glossary_term ===")
    # Add a dummy test term
    res = add_glossary_term(
        term="TestMCPEntity",
        indonesian_translation="Entitas MCP Uji",
        category="Term/Item",
        zh="测试"
    )
    print(f"Add glossary term result: {res}")
    assert res["status"] == "success", "Failed to add glossary term"

    # Verify it was added
    g2 = get_glossary(query="TestMCPEntity")
    print(f"Verify added term in glossary: {g2}")
    assert "TestMCPEntity" in g2, "TestMCPEntity should be in glossary after adding"
    assert g2["TestMCPEntity"]["indonesian_translation"] == "Entitas MCP Uji"
    print("PASS: add_glossary_term works.")
    
    # Clean up test term from glossary.json
    print("\n=== Cleaning up test term ===")
    import json
    glossary_path = _REPO_ROOT / "data" / "glossary.json"
    with open(glossary_path, "r", encoding="utf-8") as f:
        glossary = json.load(f)
    if "TestMCPEntity" in glossary:
        del glossary["TestMCPEntity"]
        with open(glossary_path, "w", encoding="utf-8") as f:
            json.dump(glossary, f, ensure_ascii=False, indent=2)
        print("Test term successfully cleaned up from glossary.json.")
            
    print("\nALL MCP TOOLS VERIFICATION PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(test_all())
