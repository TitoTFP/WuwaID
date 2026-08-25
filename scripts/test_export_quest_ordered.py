import unittest

from export_quest_ordered import (
    QuestTreeNodeInfo,
    has_available_dialogue,
    order_main_story_nodes_strict,
    parse_flowstate_key,
    renumber_lines_globally,
)


def node(
    node_id: int,
    *,
    node_type: int = 1,
    pre_nodes: list[int] | None = None,
    next_node: int = 0,
) -> QuestTreeNodeInfo:
    return QuestTreeNodeInfo(
        node_id=node_id,
        chapter_id=1,
        quest_ids=[node_id * 10],
        quest_type=1,
        node_type=node_type,
        pre_nodes=pre_nodes or [],
        next_node=next_node,
    )


class ExportQuestOrderedTests(unittest.TestCase):
    def test_orders_chain_and_interleaves_branches_after_anchor(self):
        ordered = order_main_story_nodes_strict(
            [
                node(2, pre_nodes=[1]),
                node(1, next_node=2),
                node(3, node_type=2, pre_nodes=[1]),
            ]
        )
        self.assertEqual([item.node_id for item in ordered], [1, 3, 2])

    def test_rejects_ambiguous_or_dangling_main_story_links(self):
        with self.assertRaisesRegex(ValueError, "Ambiguous main quest roots"):
            order_main_story_nodes_strict([node(1), node(2)])

        with self.assertRaisesRegex(ValueError, "missing next node"):
            order_main_story_nodes_strict([node(1, next_node=99)])

    def test_parses_flow_keys_and_detects_real_dialogue(self):
        self.assertEqual(parse_flowstate_key("MainFlow_12_3"), ("MainFlow", 12, 3))
        self.assertIsNone(parse_flowstate_key("not-a-flow-key"))
        self.assertTrue(
            has_available_dialogue(
                [
                    {"text_zh-Hans": "***", "options": [{"text_zh-Hans": "Choose"}]}
                ]
            )
        )
        self.assertFalse(has_available_dialogue([{"text_zh-Hans": "***"}]))

    def test_renumbers_lines_and_jump_targets_per_state(self):
        lines = [
            {
                "id": 1,
                "state_key": "StateA_1_1",
                "options": [
                    {
                        "actions": [
                            {"name": "JumpTalk", "params": {"TalkId": 2}},
                        ]
                    }
                ],
            },
            {"id": 2, "state_key": "StateA_1_1", "options": []},
            {
                "id": 1,
                "state_key": "StateB_1_1",
                "options": [
                    {
                        "actions": [
                            {"name": "JumpTalk", "params": {"TalkId": 1}},
                        ]
                    }
                ],
            },
        ]
        renumber_lines_globally(lines)
        self.assertEqual([line["id"] for line in lines], [1, 2, 3])
        self.assertEqual(lines[0]["options"][0]["actions"][0]["params"]["TalkId"], 2)
        self.assertEqual(lines[2]["options"][0]["actions"][0]["params"]["TalkId"], 3)


if __name__ == "__main__":
    unittest.main()
