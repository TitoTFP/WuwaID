import { QuestDetail, Chapter, TextCategory } from '../types';

export const fontMockData: Chapter[] = [
  {
    id: 'ch1',
    number: 'Chapter I',
    title: 'Utterance of Frost & Thunder',
    region: 'Jinzhou City',
    questCount: 18,
    totalLines: 4200,
    progressPercentage: 100,
    description: 'Awal perjalanan Rover terbangun di lembah Huanglong dan bertemu Yangyang & Chixia di Jinzhou.'
  },
  {
    id: 'ch2',
    number: 'Chapter II',
    title: 'Beneath the Crescent Moon',
    region: 'Central Plains',
    questCount: 24,
    totalLines: 6100,
    progressPercentage: 98,
    description: 'Menelusuri anomali gelombang Tacet Discords di Dataran Tengah Huanglong.'
  },
  {
    id: 'ch3',
    number: 'Chapter III',
    title: 'Echoes of the Huanglong Tide',
    region: 'Mt. Firmament',
    questCount: 30,
    totalLines: 8900,
    progressPercentage: 95,
    description: 'Perjalanan menuju Gunung Firmament dan mengungkap rahasia Sentinel Jue.'
  },
  {
    id: 'ch4',
    number: 'Chapter IV',
    title: 'Solitary Path of the Resonator',
    region: 'The Black Shores',
    questCount: 12,
    totalLines: 3400,
    progressPercentage: 92,
    description: 'Memasuki jaringan Black Shores dan bertemu Shorekeeper di Tethys System.'
  }
];

export const MOCK_QUEST_DETAILS: Record<string, QuestDetail> = {
  'quest_ch1_01': {
    id: 'quest_ch1_01',
    chapterId: 'ch1',
    chapterTitle: 'Chapter I: Utterance of Frost & Thunder',
    title: {
      en: 'Utterance of Frost and Thunder',
      id: 'Ucapan Es dan Halilintar',
      'zh-Hans': '霜雷之言',
      ja: '霜雷の言の葉'
    },
    summary: {
      en: 'Rover awakens in the desolate valley near Jinzhou and encounters Yangyang.',
      id: 'Rover terbangun di lembah terpencil dekat Jinzhou dan bertemu Yangyang.'
    },
    type: 'main',
    totalLines: 8,
    updatedAt: new Date().toISOString(),
    lines: [
      {
        id: 'line_101',
        lineNo: 1,
        type: 'scene_separator',
        speaker: { id: 'narrator', name: { en: 'Narrator', id: 'Narasi', 'zh-Hans': '旁白', ja: 'ナレーション' } },
        text: {
          en: '--- Gorges of Spirits • Awakening ---',
          id: '--- Ngarai Roh • Kebangkitan ---',
          'zh-Hans': '--- 峡谷残响 • 觉醒 ---',
          ja: '--- 精霊の峡谷 • 覚醒 ---'
        }
      },
      {
        id: 'line_102',
        lineNo: 2,
        speaker: {
          id: 'yangyang',
          name: { en: 'Yangyang', id: 'Yangyang', 'zh-Hans': '秧秧', ja: 'ヤンヤン' }
        },
        text: {
          en: 'You are awake... Are you feeling alright? Don\'t strain yourself just yet.',
          id: 'Kamu sudah sadar... Apakah kamu baik-baik saja? Jangan memaksakan diri dulu.',
          'zh-Hans': '你醒了……感觉还好吗？先别急着站起来。',
          ja: '目が覚めましたか……気分はどうですか？まだ無理はしないでください。'
        }
      },
      {
        id: 'line_103',
        lineNo: 3,
        speaker: {
          id: 'rover',
          name: { en: 'Rover', id: 'Rover', 'zh-Hans': '漂泊者', ja: '漂泊者' },
          isPlayer: true
        },
        type: 'choice',
        text: {
          en: 'Where am I...?',
          id: 'Di mana aku sekarang...?',
          'zh-Hans': '这是哪里……？',
          ja: 'ここはどこですか……？'
        },
        options: [
          {
            id: 'opt_1',
            text: {
              en: 'Where am I...? Who are you?',
              id: 'Di mana aku...? Siapa kamu?',
              'zh-Hans': '这是哪里……？你是谁？',
              ja: 'ここはどこ……？あなたは誰？'
            }
          },
          {
            id: 'opt_2',
            text: {
              en: 'My memory is hazy... What happened?',
              id: 'Ingatanku kabur... Apa yang terjadi?',
              'zh-Hans': '我的记忆很模糊……发生了什么？',
              ja: '記憶が曖昧だ……何があったの？'
            }
          }
        ]
      },
      {
        id: 'line_104',
        lineNo: 4,
        speaker: {
          id: 'yangyang',
          name: { en: 'Yangyang', id: 'Yangyang', 'zh-Hans': '秧秧', ja: 'ヤンヤン' }
        },
        text: {
          en: 'This is the Gorges of Spirits, near Jinzhou City. I am Yangyang, an Outrider of the Midnight Rangers.',
          id: 'Ini adalah Ngarai Roh, tidak jauh dari Kota Jinzhou. Aku Yangyang, seorang Pengelana Midnight Rangers.',
          'zh-Hans': '这里是瑝陇的今州城附近的残响峡谷。我是巡尉秧秧。',
          ja: 'ここは皇瓏の今州城の近くにある残響峡谷です。私は夜帰の巡警、ヤンヤンと申します。'
        }
      },
      {
        id: 'line_105',
        lineNo: 5,
        speaker: {
          id: 'chixia',
          name: { en: 'Chixia', id: 'Chixia', 'zh-Hans': '炽霞', ja: 'シカ' }
        },
        text: {
          en: 'Yangyang! Hey! Is our new friend awake now? I brought some fresh water!',
          id: 'Yangyang! Hei! Apakah teman baru kita sudah bangun? Aku membawakan air segar!',
          'zh-Hans': '秧秧！嘿！我们的新朋友醒了吗？我带了些凉水过来！',
          ja: 'ヤンヤン！ねえ！新しいお友達は起きた？新鮮なお水を持ってきたよ！'
        }
      },
      {
        id: 'line_106',
        lineNo: 6,
        speaker: {
          id: 'baizhi',
          name: { en: 'Baizhi', id: 'Baizhi', 'zh-Hans': '白芷', ja: 'ビャクシ' }
        },
        text: {
          en: 'Keep your voice down, Chixia. The Frequency fluctuations around them are still stabilizing.',
          id: 'Kecilkan suaramu, Chixia. Fluktuasi Frekuensi di sekitar mereka masih dalam tahap stabilisasi.',
          'zh-Hans': '小声点，炽霞。他们体内的频段波动还在稳定阶段。',
          ja: '声を小さくして、シカ。彼らの周りの周波数波形はまだ安定化の途中です。'
        }
      },
      {
        id: 'line_107',
        lineNo: 7,
        speaker: {
          id: 'jiyan',
          name: { en: 'Jiyan', id: 'Jiyan', 'zh-Hans': '忌炎', ja: 'キエン' }
        },
        text: {
          en: 'Welcome to Jinzhou, Resonator. Your awakening heralds a shift in the tide.',
          id: 'Selamat datang di Jinzhou, Resonator. Kebangkitanmu menandai perubahan arah angin gelombang.',
          'zh-Hans': '欢迎来到今州，共鸣者。你的觉醒预示着潮汐的转变。',
          ja: '今州へようこそ、共鳴者よ。あなたの覚醒は潮の目を変える兆しとなるでしょう。'
        }
      },
      {
        id: 'line_108',
        lineNo: 8,
        speaker: {
          id: 'rover',
          name: { en: 'Rover', id: 'Rover', 'zh-Hans': '漂泊者', ja: '漂泊者' },
          isPlayer: true
        },
        text: {
          en: 'Thank you all. I stand ready to face whatever lies ahead.',
          id: 'Terima kasih semuanya. Aku siap menghadapi apa pun yang ada di depan.',
          'zh-Hans': '谢谢大家。我已经准备好面对前方的漫漫征途。',
          ja: 'みんな、ありがとう。これからの道のりに立ち向かう覚悟はできています。'
        }
      }
    ]
  }
};

export const MOCK_TEXT_CATEGORIES: TextCategory[] = [
  { id: 'cat_items', name: 'Item & Material Names', description: 'Nama item, resonator upgrade materials, dan konsumsi.', totalItems: 1420, translatedItems: 1420 },
  { id: 'cat_skills', name: 'Resonator Skill Texts', description: 'Deskripsi skill Forte, Resonance Liberation, dan Inherent Skill.', totalItems: 860, translatedItems: 845 },
  { id: 'cat_echoes', name: 'Echo Names & Stats', description: 'Nama Echo, Sonata Effects, dan deskripsi skill Echo.', totalItems: 380, translatedItems: 380 },
  { id: 'cat_system', name: 'System UI & Settings', description: 'String antarmuka sistem, menu opsi, dan pesan pop-up.', totalItems: 950, translatedItems: 932 }
];
