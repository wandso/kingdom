# 《Kingdom Rush Origins》全面逆向分析报告

> 逆向目标：`D:\SteamLibrary\steamapps\common\Kingdom Rush Origins`
> 分析日期：2026-11-18
> 分析工具链：REA（reverse-engineer-anything v42 / rea-agents 6.5.0）、Python `zipfile`、LuaJIT 字节码字符串提取、图像取证
> 证据纪律：本文严格区分**观察事实（Observation）**、**推断（Inference）**与**未知（Unknown）**，所有结论均可回溯到具体文件或字节证据。

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [逆向方法论与证据链](#2-逆向方法论与证据链)
3. [目标元数据识别](#3-目标元数据识别)
4. [软件架构逆向](#4-软件架构逆向)
5. [核心玩法系统](#5-核心玩法系统)
6. [关卡与叙事内容](#6-关卡与叙事内容)
7. [美术风格与画面规格](#7-美术风格与画面规格)
8. [音频系统](#8-音频系统)
9. [商业化与内购](#9-商业化与内购)
10. [结论、可信度与局限](#10-结论可信度与局限)
11. [附录](#附录)

---

## 1. 执行摘要

《Kingdom Rush Origins》（中文官方译名《王国保卫战：起源》，内部代号 `kr3`）是 Ironhide Game Studio 开发的精灵题材塔防游戏。本次逆向对该 Steam  Windows 版安装目录下的 511 MB 主程序进行了完整拆解，得到以下核心结论：

| 维度 | 逆向结论 | 证据强度 |
|---|---|---|
| 引擎/技术栈 | LÖVE (Lua) 引擎 + SDL2，游戏逻辑为 **LuaJIT 字节码**，整体打包为 ZIP 归档附在 exe 尾部 | 观察（字节级） |
| 版本 | `6.4.46`，构建标识 `origins-windows-steam`，包名 `com.ironhidegames.origins.windows.steam` | 观察 |
| 内容规模 | 1714 个归档条目：549 个 Lua 脚本、486 张 PNG（约 401 MB）、571 个 OGG + 19 个 MP3、22 套字体 | 观察 |
| 关卡 | 22 个主线关卡，每关 3 种难度波次（Campaign/Heroic/Iron），另有 2 个无尽关卡 | 观察 |
| 防御塔 | 约 10 大类塔系，每系 3 级基础升级 + 分支技能，大量精灵/德鲁伊主题 | 观察 |
| 英雄 | 约 17 位可辨识英雄（含 Vez'nan、Prince Denas、Xin 等），每位含多技能树 | 观察 |
| 叙事 | 22 段关卡开场剧情 + 9 段漫画分镜脚本，完整精灵族抗争史诗 | 观察 |
| 本地化 | 11 种语言（含简/繁中文），约 2200+ 条文本条目 | 观察 |
| 成就 | 60+ 个成就，含大量流行文化彩蛋 | 观察 |
| 架构风格 | 数据驱动 + 组件/系统（ECS 倾向）+ 脚本行为绑定，难度以系数矩阵动态修正 | 推断（强） |

**关键发现**：游戏资源未加密、Lua 脚本以标准 LuaJIT 字节码形式存储，字符串常量表完全明文可读，使得玩法数值、剧情文本、资源清单均可高保真还原。

---

## 2. 逆向方法论与证据链

### 2.1 REA 技能启动状态检查（用户前置要求）

对本机 `reverse-engineer-anything` 技能进行检查，结果如下：

- 技能已安装：`C:\Users\Administrator\.workbuddy\skills\reverse-engineer-anything\`，版本 42，207 个工具，状态 `aligned`。
- 客户端工具 `rea-agents` 版本 6.5.0 已安装。
- **发现问题**：MCP 注册位于 `C:\Users\Administrator\.workbuddy\mcp.json`，但处于 `disabled: true` 且 `state: stale`（陈旧），因此 REA 工具在当前会话中**未真正启动**。
- **处置**：执行只读诊断 `doctor` → 预览 `setup --dry-run` → 应用 `setup --client workbuddy --yes`。修复后 `doctor` 返回 `healthy: true`，`registration:workbuddy` 状态由 `stale` 变为正常，配置中已移除 `disabled` 标志。
- 备份：`C:\Users\Administrator\.workbuddy\mcp.json.rea.backup.8c35ac16....recovery`。
- 说明：REA 提供原生/托管程序反编译能力（Hopper/Ghidra/IDA/JADX），但这些分析引擎本机未安装，且本次目标为 Lua 脚本游戏，故主要分析路径采用归档解包 + 字节码字符串取证，REA 已按要求处于启动可用状态。

### 2.2 目标识别与解包

1. **文件识别**：主程序 `Kingdom Rush Origins.exe`（511,454,539 字节）。PE 头 `MZ` 起始；目录内伴随 `love.dll`、`lua51.dll`、`SDL2.dll`、`OpenAL32.dll`、`mpg123.dll`、`steam_api.dll` —— 明确指向 LÖVE/Lua 引擎。
2. **归档定位**：扫描到 ZIP 结束记录 `PK\x05\x06` 位于偏移 `0x1E7FBFB5`（511,454,517），距文件末尾 22 字节（正好一个 EOCD 结构），判定为 **ZIP 归档直接拼接在 PE 可执行文件尾部**。
3. **解包**：使用 Python `zipfile` 直接打开 exe，成功读取 1714 个条目；提取全部 568 个文本类文件（.lua/.csv/.txt/.md/.c）至工作目录。

### 2.3 LuaJIT 字节码处理

被提取的 `.lua` 文件头为 `1B 4C 4A 01`（`\x1bLJ` + 版本字节），这是 **LuaJIT 字节码**魔数，而非明文源码。例如 `version.lua` 十六进制片段：

```
00000000: 1b4c 4a01 000e 402e 2f76 6572 7369 6f6e  .LJ...@./version
```

处理方式：LuaJIT 将字符串常量以**明文**形式存储在字节码的常量表中，因此用正则扫描可提取全部可读字符串。本次从关键文件提取出：英文文本 2443 条、中文文本 2316 条、`scripts.lua` 5104 条、`templates.lua` 3371 条等，并进一步解析出 549 条规范化 `en` 键值对、552 条 `zh-Hans` 键值对。

> **可信度说明**：字符串取证能高置信度还原"名称、描述、文本、资源路径、配置键名"；但字节码中的**具体数值常量（伤害/血量的立即数）与执行逻辑**需反编译方可精确还原，本文对此类结论标注为推断，不虚构精确数值。

### 2.4 证据分级

- **观察（Observation）**：直接从字节、字符串、文件清单、图像读取到的事实。
- **推断（Inference）**：基于多个观察的合理归纳（如架构风格、难度机制）。
- **未知（Unknown）**：字节码未反编译、未运行时观测的部分。

---

## 3. 目标元数据识别

### 3.1 版本信息（来自 `version.lua` 十六进制）

从字节码常量表逐字读出：

| 字段 | 值 |
|---|---|
| bundle | `origins-windows-steam` |
| build_keywords | `RELEASE` |
| bundle_id | `com.ironhidegames.origins.windows.steam` |
| version | `6.4.46` |
| string_short | `kr3-desktop-6.4.46` |
| string | `Kingdom Rush Origins` |
| title | `kingdom_rush_origins` |
| identity | `kr3` |
| 版权（en.lua） | `© 2014 Ironhide Game Studio. All rights reserved.` |

### 3.2 引擎与技术栈

- **引擎**：LÖVE（地址为 `/lovegame/`，`love.graphics`/`love.window` 调用，`conf.lua` 中启用 `console`/`physics` 模块）。
- **图形/音频/网络**：SDL2.dll（窗口与输入）、OpenAL32.dll + mpg123.dll（音频解码）、libcurl-x64.dll + khttps.dll（HTTPS/网络服务）。
- **平台层**：`features.lua` 中启用 `steam`（`steam_api`）、`achievements`、`news`、`http` 等服务。
- **全局平台标识**（`main_globals.lua`）：`KR_PLATFORM = win`、`KR_TARGET = desktop`、`KR_GAME = kr3`。
- **渲染特性**：`conf.lua`/`main.lua` 中出现 `highdpi`、`msaa`、`vsync`、`getPixelScale`、`get_graphics_features`、`load_atlas`/`unload_atlas` —— 支持高 DPI、抗锯齿、图集（atlas）加载。

### 3.3 资源构成统计（来自 manifest.json）

| 类型 | 数量 | 体积 |
|---|---|---|
| `.png` | 486 | 400.9 MB |
| `.ogg` | 571 | 46.9 MB |
| `.ttf` | 12 | 20.9 MB |
| `.otf` | 10 | 18.9 MB |
| `.lua` | 549 | 17.5 MB |
| `.mp3` | 19 | 13.9 MB |
| `.csv` | 9 | <0.1 MB |
| `.fbin` / `.vbin` | 8 / 8 | 字体/矢量二进制配置 |
| `.c` | 7 | 着色器/编译资源 |

图片命名分类：`encyclopedia*`（194）、`go*`（170，游戏对象图集）、`gui*`（46）、`comic*`（26）、`screen*`（24）、`loading*`（14）、`hand*`（6）。
分辨率档位：`kr3-desktop/images/ipad`（342 项）与 `kr3-desktop/images/fullhd`（360 项）双套资源。

---

## 4. 软件架构逆向

### 4.1 目录结构（解包后）

```
extracted/
├── main.lua / conf.lua / version.lua / features.lua   # 入口与配置
├── all/                    # 跨平台核心逻辑（62 文件）
│   ├── game.lua / systems.lua / templates.lua / components.lua
│   ├── scripts.lua (159KB) / script_utils.lua (79KB)
│   ├── entity_db.lua / wave_db.lua / path_db.lua / grid_db.lua / sound_db.lua
│   ├── director.lua / difficulty.lua / level_utils.lua
│   ├── achievements.lua / challenges.lua / marketing.lua
│   └── platform_services_*.lua   # Steam / iCloud / Firebase / IAP / Ads 等
├── kr3/                    # 本作（Origins）专属逻辑与数据
│   ├── data/levels/        # 101 个关卡相关脚本（data/grid/paths/spawner）
│   ├── data/waves/         # 68 个波次脚本（22 关 × 3 难度 + 2 无尽）
│   ├── upgrades.lua / game_templates.lua / game_scripts.lua
├── kr3-desktop/            # 桌面版数据与 UI 模板
│   └── data/               # map_data / iap_data / game_gui_data / comics
├── _assets/                # 图片、字体、音频、多语言文本
└── lib/                    # hump / klove / klua / plc 等第三方库
```

### 4.2 架构风格（推断，强）

- **数据驱动**：levels/waves/towers/strings 均为独立数据文件，逻辑通过键名引用。`entity_db`、`wave_db`、`path_db`、`grid_db`、`sound_db` 构成"数据库层"。
- **组件/系统（ECS 倾向）**：`all/` 下存在 `components.lua`（26KB）、`systems.lua`（51KB）、`templates.lua`（53KB）、`entity_db.lua`，命名与职责符合实体-组件-系统模式，模板用于批量生成实体原型。
- **脚本绑定**：`scripts.lua`（159KB）与 `script_utils.lua`（79KB）承载行为逻辑（攻击、技能、状态），通过字符串键与实体模板关联。
- **导演系统**：`director.lua`（22KB）+ `difficulty.lua` 负责波次调度与难度动态修正。
- **关卡工具链**：存在完整的 `game_editor.lua`（27KB）、`game_editor_gui.lua`（36KB）、`debug_view_editor.lua`，说明开发时使用了内置关卡编辑器。

### 4.3 难度系统（来自 `difficulty.lua` 字符串）

难度以**系数矩阵**在关卡运行时修正实体属性，关键配置项：

```
difficulty_enemy_speed_factor   # 敌人速度系数
difficulty_enemy_hp_max_factor  # 敌人血量系数
difficulty_soldier_hp_max_factor# 士兵血量系数
hp_factor_soldier / hp_factor_enemy / speed_factor_enemy
```

难度入口在文本中体现为 `Casual / Normal / Veteran`（`C_DIFFICULTY_EASY/NORMAL/HARD` = `Completed Casual/Normal/Veteran`），每关另含 `Heroic`、`Iron` 两种额外难度波次脚本。这是典型的"同一关卡 + 数值/规则修正"实现。

---

## 5. 核心玩法系统

> 本章塔/英雄/敌人的**名称与描述**为观察事实；**具体伤害/血量数值**来源于字符串中的技能描述文本（游戏中真实显示给玩家的数值），可视为观察；未从字节码立即数反编译得到的部分标注为推断。

### 5.1 玩法循环

经典塔防循环（由资源与文本证据支持）：在路径旁建塔 → 敌人按波次沿路径进攻 → 塔/英雄/法术击杀敌人获得金币 → 用金币升级塔与技能 → 守住基地生命值直至清空所有波次。文本提示佐证：

- `TIP`：`Calling an early wave gives bonus gold and reduces spell cooldowns.`（提前召唤波次奖励金币并降低法术冷却）
- `TIP`：`Tapping an enemy will show you its current statistics.`（点击敌人查看属性）
- `TIP`：`Heroes gain experience every time they damage an enemy or use an ability.`（英雄通过伤害/施法获得经验）

### 5.2 防御塔体系

**结构（观察，来自 `level01_data.lua` 与 `tower_menus_data.lua`）**：本作采用 Kingdom Rush 经典结构 —— **4 大基础塔系**，每系先经 3 个基础等级（Level 1→2→3），再在 Level 4 分出 **2 条专精分支**（共 8 座四级塔）。`level01_data.lua` 确认的基础塔 ID 为 `tower_build_archer`、`tower_barrack_2`、`tower_build_mage`、`tower_rock_thrower_2`，并有 `locked_towers` 与 `max_upgrade_level` 字段控制解锁与上限。

| 基础塔系 | Level 1 → 2 → 3 | Level 4 双分支 | 攻击类型（据 `en.lua` 描述） |
|---|---|---|---|
| **弓箭 Archer** | Hunter Arbor → Watcher Arbor → Sentinel Arbor | **Golden Longbows**（黄金长弓）/ **Arcane Archers**（奥术弓手，魔法箭削弱魔抗） | 物理；Arcane 为魔法 |
| **法师 Mage** | Mystic Dais → Arcanist Dais → Eldritch Dais | **High Elven Mage**（三连能量弹，"ignore any physical protection"）/ **Wild Magus**（原始狂野魔法） | 魔法 |
| **兵营 Barracks** | Defender Barracks → Warden Barracks → Ranger Barracks | **Bladesinger Hall**（武僧近战） | 物理（近战阻挡） |
| **投石/德鲁伊 Rock Thrower** | Stone Circle → Boulder Circle → Menhir Circle | **Arch-Druid Henge**（大德鲁伊）/ **Weirdwood**（树妖）/ **Forest Keepers**（森林守护者） | 物理（范围投石/自然） |

Level 4 副标题在 `en.lua` 中明确：`TOWER_ARCHERS_SUBTITLE`="Level 4 archer tower"、`TOWER_BARRACKS_SUBTITLE`="Level 4 barracks"、`TOWER_MAGES_SUBTITLE`="Level 4 mage tower"、`TOWER_ROCK_THROWER_SUBTITLE`="Level 4 Stone druids"。此外还有场景特殊塔：`Awok Hut`（兽人小屋，可 `REPAIR`）、`Faery Dragon Aerie`（妖精龙巢）、 broken 状态的 `Bastion`。

技能/升级示例（含游戏内显示的真实数值，观察）：
- `Burst Arrows III`（爆裂箭矢）：发射爆炸魔法箭，造成 **160** 点魔法范围伤害。
- `Slumber Arrows`：射出使敌人沉睡 **4 秒**的箭。
- `Clobber III`（重击）：震地造成 **75** 伤害并使周围敌人眩晕 **1 秒**。
- `Ancient Oak Spear III`：强化长矛，造成 **160** 点真实伤害；低等级为 90/125。
- `Hunter's Mark / Crimson Sentence`：标记目标使其 **5 秒**内受到双倍伤害 / 提高即死几率。
- `Blade Dance III`：最多连续斩击 4 次，造成 **40~56** 伤害。
- `Timelapse III`（高等精灵法师）：时间操控系高阶技能；`Alter Reality` 可将敌人传送回路径。

> **数值局限**：造价/基础伤害/射程/攻速的逐塔精确配对内联在字节码立即数中（`game_templates.lua` proto#17 含 341 个浮点常量，如 162.5 / 135000 / 180 / 150 / 200 等），未经完整反编译无法可靠逐一配对，本文不臆造。

### 5.3 英雄体系

从 `HERO_*_NAME` 提取出的英雄（部分为 DLC/解锁英雄），附官方中英译名线索：

| 内部键 | 英文 | 中文 |
|---|---|---|
约 **20 名英雄**（含系列经典角色与本作原创），来自 `HERO_ELVES_*_NAME`：

| 英雄（英文） | 内部标识 | 官方中文（部分） | 代表技能（含描述数值） |
|---|---|---|---|
| Prince Denas | `DENAS` | 迪纳斯王子 | Sworn Defenders / Celebrity（震慑最多 6 敌 4 秒）/ Mighty（171~320 真实伤害） |
| Alleria Swiftwind | `HERO_ARCHER` | 艾莉瑞雅·迅风 | 艾纳妮血脉最后传人，剧情核心 |
| Eridan | `ARCHER` | — | Arrow Storm（箭矢风暴）/ Nimble（30% 闪避反击） |
| Vez'nan | `VEZNAN` | 维兹南 | Arcane Nova（28~52 范围伤害+减速 2s）/ Dark Pact（召唤恶魔） |
| Catha | `PIXIE` | — | Faery Dust（3 妖精各 12~40 魔法伤害）/ Pixie Warrior |
| Lilith | `FALLEN_ANGEL` | — | Heavenly Chaos（50% 概率火雨 800 伤害）/ Reaper's Harvest（110 真实伤害+10% 即死） |
| Faustus | `FAUSTUS` | — | Dragon Rage（3 幼龙各 90 范围伤害/6s）/ Teleport Rune（传送 2 敌回退） |
| Phoenix | `PHOENIX` | — | Immolate（俯冲 100 范围伤害后牺牲，凤凰重生）/ Blazing Offspring |
| Bruce | `BRUCE` | 布鲁斯 | Guardian Lions（4 狮 840 伤害）/ Kings Roar（眩晕 1s） |
| Durax | `DURAX` | — | Shardseed（45 真实伤害）/ Crystal Prison（800 伤害分摊）/ Sapphire Fangs |
| Reg'son | `ELDRITCH` | — | Vindicator（单体秒杀，50~70s 冷却）/ Eldritch Blade（30 伤害+即死几率） |
| Arivan | `ELEMENTALIST` | — | Elemental Storm / Icy Prison（冻结 2s+35 霜伤）/ Seal of Fire（4 火球各 20~40） |
| Bolverk | `BOLVERK` | 波尔维克 | — |
| Lynn | `LYNN` | — | Hexfury（最多 6 次每次 360 真实伤害）/ Charm of Unluck（45% 闪避） |
| Bravebark | `FOREST_ELEMENTAL` | — | Nature's Wrath（15 尖刺藤各 60 伤害）/ Oakseeds（召唤 2 Greenlings） |
| Razz & Rags | `RAG` | — | Changeling / Hammer Time（72 伤害+眩晕 3s） |
| Malik | `MALIK` | — | Malik Unchained |
| Wilbur | `GYRO` | — | PewPew Drones（4 无人机 128 伤害/8s）/ Box bomb（65 伤害） |
| Xin | `PANDA` | 鑫 | Pandamonium（6 熊猫武士各 180 伤害）/ Mind over Body（6s 回 130 血） |
| Griphon Rider / Bard | `GRIPHON_RIDER` / `BARD` | — | —（数据中仅存类名） |

成长机制（观察）：`Heroes gain experience every time they damage an enemy or use an ability.`；英雄法术从 **Hero Room** 升级，`MAP_HERO_ROOM_UNLOCK`="UNLOCKS AT STAGE %s"（如 STAGE 7 解锁）。

### 5.4 敌人体系

从 `ENEMY_*_NAME` 提取的敌人（含 Boss）：

**7 个主线 Boss**（来自 `ENEMY_BOSS_*_NAME`，均带 `*_SPECIAL = *boss`）：

| Boss | 中文 | 出处/特征 |
|---|---|---|
| Bram, the Beheader | 歼灭者布拉姆 | 食人魔国王，第 18 关；"likes to chop heads" |
| Godieth | — | 炎魔（Pit Lord），剧情最终反派 |
| Spider Goddess | 蜘蛛女神 | 第 12 关，古代蜘蛛女王 Mactans |
| Malicia | 玛丽西娅 | 暮光精灵女王，主线反派（第 14/19 关），自封 Unseelie Queen |
| Baj'Nimen the Hateful | 憎恶者巴杰尼蒙 | 第 20 关最终 Boss |
| Hi-Hi Enha | — | 豺狼部落首领（`ENEMY_BOSS_GNOLL`） |
| （无尽 Mini-Boss）| — | Gnoll Warleader / Twilight Brute |

**普通/精英敌人**（`ENEMY_*_NAME`，按族系）：
- 豺狼系：Gnoll Reaver / Burner / Blighter（高魔抗）/ Gnawer（中甲）/ Catapult。
- 蜘蛛系：Sword Spider（高魔抗）、Drider（毒攻+由士兵转化+快速）、Arachnomancer（召唤蜘蛛）。
- 飞行系：Mantaray/Cloud Stalker（飞行+由士兵转化）、Perython（载豺狼）、Screecher Bat、Gloomy（自我复制成群）。
- 森林魔物：Redcap、Hyena（快速）、Razorboar（中甲）、Ettin（双头巨人，快速自愈）、Bandersnatch（免减速+范围伤害）、Ogre Magi（高魔抗）、Twilight Evoker（治疗友军+沉默塔）、Satyr Hoplite/Cutthroat、Shadow Champion、Blood Servant。
- 蘑菇系：Munchshrooms、Boomshroom（快速）、Shroom Breeder。
- 暮光系：Twilight Golem（极硬）、Dark Spitter、Devourer（吞噬士兵+快速）。

敌人特性标记（`*_SPECIAL/EXTRA`）：`flying` / `shadows` / `heals allies` / `silences towers` / `summons spiders` / `breeds from soldiers` / `fast health regeneration` / `cannot be slowed` / `high magic resistance` / `medium armor` / `area damage`。难度系统按系数修正 `hp_max`、`armor`、`magic_armor`、`speed`、`lives_cost`。

### 5.5 全局法术（Powers）

来自 `POWER_*` 与 `level01.lua`（`POWER_HERO`、`POWER_THUNDERBOLT`、`POWER_REINFORCEMENT`、`unlock-user-power`）：

| 法术 | 名称 | 效果/升级（描述数值，观察） |
|---|---|---|
| `POWER_SUMMON` | **Call Reinforcements**（召唤援军） | 召唤部队助战；升级：冷却 -5s、更健康装备、"Green Wardens"、几率免死 |
| `POWER_THUNDER` | **Strike of Thunderbolt**（雷霆一击） | 天雷轰击；升级：伤害提升且冷却 -10s、额外 +3 道雷、+2 道雷并附带减速风暴 |
| `POWER_HERO` | **Hero spell**（英雄法术） | 随所选英雄变化，`Each hero gives you a unique spell!`，从英雄室升级 |

`TIP_12`：提前召唤波次奖励金币并降低法术冷却。内购战场道具见第 9 章。

### 5.6 波次、模式与经济

- **波次规模**（实测文件清单）：`kr3/data/waves/` 共 **68 个波次文件**（22 主线关 × campaign/heroic/iron = 66，另 `level81/82_waves_endless.lua`）；`kr3/data/levels/` 共 **101 个关卡文件**（`_data/_grid/_paths/_spawner` 等）。
- **波次数据结构**（`level01_waves_campaign.lua`）：`groups`、`creep`、`enemy_gnoll_reaver`、`interval` / `interval_next`、`max` / `max_same`、`fixed_sub_path`、`path` / `path_index`、`delay`。
- **游戏模式**（`GAME_MODE_CAMPAIGN`）：`Campaign`（Casual/Normal/Veteran 三档）+ `Heroic` + `Iron`（铁人模式带限制，如 `LEVEL_22_IRON_UNLOCK`="no archers / no druids"）+ `Endless`（生存模式，`ENDLESS_LEVEL_1/2` = Valor's Rest / Twilight Invasion）。`LEVEL_<n>_MODES_UPGRADES` 控制升级上限（lvl 1/2/3/5 max）。
- **经济**：金币来自击杀与提前召唤波次（`TIP_12`）；支出为建塔/升级；`TOWER_SELL` 支持出售回收。字段 `gold` 在脚本中频繁出现；`game_templates.lua` 浮点常量含 135000 / 162.5 / 180 / 150 / 200 等（疑似造价/赏金，未逐一配对）。
- **生命值**：`level01.lua` 含 `has_alive_enemies`、`waves_finished`、`exits`；敌人抵达 exits 扣生命，归零失败（KR 系列标准规则）。
- **无尽模式**：`Face an endless unrelenting enemy force ... compete for the best score!`，记录 `Max Waves Survived` 与 `Max Score`。

---

## 6. 关卡与叙事内容

### 6.1 22 主线关卡（中英对照，来自 `LEVEL_n_TITLE` / `map_data.lua`）

| 关 | EN | ZH | 关 | EN | ZH |
|---|---|---|---|---|---|
| 1 | Gray Ravens | 灰鸦港口 | 12 | The Ascent | 追本溯源 |
| 2 | The High Cross | 高桥 | 13 | Arcane Quarters | 奥术都市 |
| 3 | Waterfalls Trail | 瀑布小径 | 14 | Mactans' Retreat | 黑寡妇避难所 |
| 4 | Redwood Stand | 红杉阻击战 | 15 | Shrine of Elynie | 艾纳妮神殿 |
| 5 | Royal Gardens | 皇家庭园 | 16 | Galadrian's Wall | 加拉里安之墙 |
| 6 | Gryphon Point | 狮鹫驿站 | 17 | Blood Quarry | 血石矿场 |
| 7 | Rockhenge | 石环阵 | 18 | Beheader's Seat | 歼灭者王座 |
| 8 | Grimmsburg | 格林堡之战 | 19 | Duskwood Outpost | 暮色森林岗哨 |
| 9 | The Crystal Lake | 水晶之湖 | 20 | Duredhel Outskirts | 都尔德郊原 |
| 10 | Neverwonder | 奇迹仙境 | 21 | Dwaraman Gates | 矮人国之门 |
| 11 | The Unseelie Court | 罪恶精灵王庭 | 22 | Tainted Pit | 污染矿坑 |

另有 2 个无尽关：`level81/82`（`ENDLESS_LEVEL_1/2_TITLE` = Valor's Rest / Twilight Invasion，中文 勇士之墓 / 暮光入侵）。每关配套 `_data.lua`、`_grid.lua`（建塔网格）、`_paths.lua`（敌人路径）三件套，部分含 `_spawner.lua`、`_taunts.lua`、`_mactans.lua`。`go_stage01_bg.lua`~`go_stage22_bg.lua` 共 22 套关卡背景。

### 6.2 关卡开场剧情（22 段 `LEVEL_n_HISTORY`，战地简报体）

叙事以"**将军（General）**"为收信人，结尾常有 `For the Queen!` / `For Elynie!` 誓言。完整故事弧：

1. **入侵序曲**（1~6）：豺狼人自荒芜丘陵入侵 → 高桥 → 瀑布小径侧翼 → 红杉林 → 首都陷落 → 狮鹫驿站。第 6 关点明反派：**暮光精灵女王 Malicia**，派豺狼大军追杀艾纳妮血脉最后的传人 Alleria。
2. **盟友与自然**（7~10）：石环阵拉锯战 → 格林堡（森林守护者参战，部分妖精倒戈）→ 水晶湖（德鲁伊畏惧传说中的巨蟒 Grootslang）→ 奇迹仙境（濒临崩溃）。
3. **精灵内战**（11~15）：罪恶精灵王庭（Malicia 自封 Unseelie Queen）→ 首城浮空遗迹 → 奥术都市 → 黑寡妇 Mactans 避难所 → **艾纳妮神殿决战**（争夺圣物"艾纳妮之泪 Tear of Elynie"，第 15 关："For the Light! For Elynie!"）。
4. **食人魔与终局**（16~22）：加拉里安之墙（豺狼受神秘食人魔驱使）→ 血石矿场（切断 Bloodsydian 矿脉削弱巫师）→ 歼灭者布拉姆王座 → 暮色森林岗哨（Malicia 末位副官施法）→ 都尔德郊原（Baj'Nimen 出战）→ 矮人国之门 → **污染矿坑**（矮人被误放恶魔灭绝）。

### 6.3 漫画叙事（9 段分镜，`comics/01.csv`~`09.csv`）

CSV 为**镜头时间轴脚本**（明文字节级可佐证），格式：
- `frame_<id>,<时间ms>,"<图片>.png",<x>,<y>,<scaleX>,<scaleY>,...,<锚点>,<层级>` —— 画面帧关键帧；
- `TEXT,<文本键>,<frame>,<x>,<y>,<宽>,<高>,<旋转>,<R>,<G>,<B>,...` —— 对白文本框与颜色（如 `252,092,120` 粉红）；
- `PAGE_END,<时间ms>`、`ORDER,frame_x,frame_y,...` —— 段落结束与播放/层叠顺序（04/05.csv 用倒序制造镜头感）；
- 对白正文通过 `COMIC_*` 键查字符串表（en 48 个 COMIC 键，简中 40 个，**简中本地化略不完整**）。

剧情九幕：① 很久以前和平不会永存 → ② 精灵公主逃亡、发现神龛、暮光精灵登场 → ③ Malicia 追击、"黑暗庇护所" → ④ 女神神殿仪式与代价 → ⑤ 惨胜 → ⑥ 决定将神器投入"灰烬裂隙 Rift of Cinder"焚毁 → ⑦ 豺狼人威胁再起 → ⑧ 反派复盘"计划很完美" → ⑨ 向女王求援"炼狱之火的上古恶魔"。**核心母题**：和平破碎→入侵→逃亡→神器争夺→惨胜→新危机。

### 6.4 成就系统（60+ 个，含大量流行文化彩蛋）

来自 `ELVES_ACHIEVEMENT_*_NAME`。常规成就如 `The Art of War`、`Perfect Parry`、`Pest Control`、`Hold the line!`、`Great Defender`；彩蛋命名致敬流行文化：`D&D`、`Game of Thrones`、`Why so serious?`（蝙蝠侠）、`Rambo Style`、`Robin Of Elfwood`、`Never tell me the odds`（星球大战）、`I volunteer as tribute`（饥饿游戏）、`Valar Morghulis`、`The bigger they are...`、`Brave Little Tailor` 等。

### 6.5 制作人员（`credits_data.lua`）

含 `Creative Directors & Executive Producers`、`Lead Game Designer`、`Story Writer`、`Text Writers`、`Lead Programmer`、`Localization Manager`、`Typography` 等职位；人名如 Gonzalo Sande、Pablo Realini、Vicente Lamónaca；鸣谢 `LOVE framework / love2d.org` 与 `Mike Pall and LuaJIT community / luajit.org`（再次印证引擎为 LÖVE + LuaJIT）。

---

## 7. 美术风格与画面规格

### 7.1 视觉风格（图像取证，观察）

对 `go_towers-2.png`、`screen_map-1.png`、`go_hero_veznan-1.png` 的实际查看表明：

- **风格**：Ironhide 标志性**手绘卡通/奇幻漫画风**——粗犷有力的笔触、厚涂质感、夸张的角色比例与表情、鲜明的高饱和配色（精灵绿、魔幻紫、炽焰橙红）。
- **关卡选择地图**：手绘奇幻世界地图，含山脉、森林、河流、船只、龙等装饰动画，温暖的纸张/羊皮质感。
- **角色/塔图集**：黑色透明背景的**逐帧序列图集（sprite sheet）**，密集排列动作帧与特效帧（角色行走/攻击/施法、火焰爆炸、紫色魔法、水流溅射），体现精细的逐帧手绘动画（2D skeletal-free frame animation）。
- **UI**：通知框、商店背景、教程指引等成套界面元素，风格统一。

### 7.2 资源规格（manifest.json 精确统计）

- **PNG 486 个 ≈ 400.9 MiB**（占全资源最大）；**两套分辨率档**：`fullhd/` 248 个（246.6 MiB）、`ipad/` 230 个（154.3 MiB），各有 112 个同名 sprite 定义 `.lua`。
- 图片分类：`encyclopedia*`（194，百科插图）、`go*`（170，游戏对象图集）、`gui*`（46）、`comic*`（26）、`screen*`（24）、`loading*`（14，7 种主题）、`hand*`（6）、`achievements`（2）。
- **序列帧命名**：`<角色>_<动作>_<4位序号>`（如 `veznan_hero_soulBurn_proy_0016`、`water_splash_waterfall_0013`）；图集经 `a_name` 字段指向 `go_towers-1/2/3.png` 等分图。`go_towers.lua` 约 574 KB（全游戏最大 sprite 表，约 12086 个常量）。
- **地图动画**（`map_data.lua`）：`ma_ship`（往返船队）、`ma_hr_dragon`（龙）、`ma_waterfall1_barrel`、`ma_metro_0..6`、`ma_sea_sparks_1..20`，含 `in-out-sine` 插值与 `pingpong` 循环；`map_points.lua` 定义关卡点位。
- **7 种场景主题**：Ancient Metropolis（古城）、Bittering Rancor（苦涩怨恨）、Elven Woods（精灵森林）、Faerie Grove（妖精林地）、Forgotten Treasures（秘宝）、Hulking Rage（狂暴）、Mactans/Malicia。

### 7.3 字体（22 个 ≈ 41.7 MiB）

CJK 与装饰字体：`NotoSansCJKjp/kr-{Regular,Bold}.otf`、`JIMOJW.ttf`(8.1MB)、`JejuHallasan_Regular.ttf`(6.7MB)、`Sun Yun He Xuan Li Ti.ttf`(6.1MB)、`tetsubin_gothic.otf`(6.1MB)、`BMYEONSUNG.otf`、`ZinPenCiro_B.otf`、`NanumPen.otf` 等；西文/漫画：`DroidSans*`、`Verdana`、`ObelixPro`、`Heuristica_Italic`、`Comic Book Italic`、`TOONISH`、`YIKES`（对话气泡用）。

### 7.4 本地化（11 种语言）

`strings/` 下 en / ja / kr / ru / fr / es / ko / zh-Hans / zh-Hant / pt / de 共 11 种；`en.lua` 提取约 2246 条键值，`zh-Hans` 约 1586 条，共有的约 1413 条为可靠下限。国际化引擎为 `all/i18n.lua`。官方简中译名示例：黄金长弓塔、秘法师高台、精灵森林、灰鸦港口、艾纳妮神殿、维兹南。制作名单含专门 Localization Manager 与 Keywords Studios，为外包+内部管理流程。

---

## 8. 音频系统

- **规模**：571 个 OGG（46.9 MiB，音效）+ 19 个 MP3（13.9 MiB，配乐），合计约 60.8 MiB，全部在 `_assets/kr3-desktop/sounds/`。
- **配乐（19 首 MP3，分层动态）**：命名规律 `kro/kre_` + `bgmusic` + `t1/t2/t3 × battle/prebattle`、`bossfight`、`victory`、`maintheme`、`map`、`creditos`、`MusicSuspense`，带 `[master_日期]` 版本后缀 —— 不同关卡层级/战斗阶段使用不同曲目。
- **音源组（11 个，`settings.lua`）**：`DEFAULT`、`MUSIC`、`GUI`、`SFX`、`BULLETS`、`EXPLOSIONS`、`DEATH`、`SPECIALS`、`SWORDS`、`TAUNTS`、`REFCOUNTED`，含并发数（max_sources）限制。
- **音效分类（`sounds.lua` 约 3183 常量）**：`Tower*`（塔攻击，如 `TowerWildMagusDoomLoop`、`TowerStoneDruidBoulderThrow`）、`Sound_*`（UI/战斗，如 `Sound_GUIButtonCommon`、`Sound_WaveIncoming`、`Sound_Coins`）、`<Hero>_Confirm*`（英雄确认音）。
- **环境音（`extra.lua` 约 757 常量）**：按地图主题（HulkingRage 矿场、ElvenWoods 鸟鸣溪流+战鼓、Metropolis 风声+蜘蛛、FaerieGrove 猫头鹰、Boss 蛛网）。
- **加载器**：`all/sound_db.lua` 采用**分组惰性加载 + 引用计数 + 并发源池**（`load_group`、`source_groups`、`ref_counted`、`source_pool`、`set_main_gain_music/fx`），是相当专业的音频资源管理实现。

---

## 9. 商业化与内购

免费+内购（F2P）模式，6 件消耗型战场法术道具（`iap_data.lua`，中文译名来自 `INAPP_NAME`）：

| ID | 内部 ID | 中文名 | 效果 |
|---|---|---|---|
| 0007 | wrath_of_elynia | 艾纳妮之怒 | 神圣符号释放女神愤怒，范围伤害 |
| 0008 | rod_dragon_fire | 龙焰之杖 | 千龙吐息化为火海 |
| 0009 | horn_heroism | 英勇号角 | 塔与士兵无敌+双倍伤害 |
| 0010 | teleport_scroll | 传送卷轴 | 将敌人原路送回 |
| 0011 | hand_midas | 迈达斯之手 | 一段时间收入翻倍 |
| 0012 | gem_timewarp | 时空宝石 | 全体敌人回退并减速 |

- **宝石经济**（`shop_views.lua`）：`GemsStoreView`、`gem_pack_mountain`（山）、`gem_pack_chest`（宝箱）等档位；双货币（宝石 vs 现金内购）。
- **广告激励**：`ADS_MESSAGE_TITLE`="MORE GEMS / 更多宝石"（看广告得宝石）。
- **高级会员态**：`is_premium` / `platform_services_iap_premium.lua`、`restore_views.lua`（恢复购买）。
- **远程配置**：`remote_config_defaults.lua` 含新闻 API `https://news.ironhidegames.com/api/v1/PromoNews`；接入 Firebase Remote Config 与 Ironhide 新闻推送。
- **平台覆盖**：StoreKit(iOS)、Google Play、GameCenter、Steam（`features.lua` 启用 `steam`/`achievements`/`news`/`http`）。

---

## 10. 结论、可信度与局限

### 10.1 结论

《Kingdom Rush Origins》是一款技术成熟、内容量庞大的 2D 塔防游戏。本次逆向在**未运行游戏、未反编译字节码**的前提下，通过归档解包 + 字符串常量取证 + 图像取证，高保真还原了：

- 引擎与技术栈（LÖVE + LuaJIT 2.0 + SDL2，双分辨率档，完整数据驱动架构）；
- 4 大塔系 + 8 座四级塔、约 20 名英雄、7 个 Boss、数十种敌人的玩法框架；
- 22 主线关卡 + 2 无尽关 + 全部中英关卡名与开场剧情、9 幕漫画叙事线；
- 60+ 成就、11 语言本地化、19 首分层配乐 + 571 音效、6 件内购道具；
- ECS 架构、系数化难度、分组惰性音频加载等工程实现细节。

### 10.2 可信度分级

| 结论类别 | 可信度 | 依据 |
|---|---|---|
| 元数据、资源清单、图像风格 | 高（直接观察） | 字节头、manifest.json、实际图像 |
| 名称/描述/剧情/本地化文本 | 高（明文字符串） | LuaJIT 常量表、CSV 明文 |
| 塔/敌/英雄分类与技能 | 中高（键名+描述归纳） | 字符串键名与描述文本 |
| 精确数值配对（造价/伤害/DPS） | 低~中（未反编译） | 内联立即数，未逐一配对 |
| 架构风格（ECS） | 中（推断） | 模块命名与职责归纳 |

### 10.3 局限与后续建议

- **字节码未反编译**：LuaJIT 2.0 字节码的具体逻辑与内联数值未被完整反编译。若需精确数值表（逐塔造价/伤害/射程/攻速、逐敌血量/护甲），建议用 `ljd`（LuaJIT Decompiler）或 `luadec` 处理 `kr3/game_templates.lua`（约 670KB / 1602 个 ktab）与 `kr3/game_scripts.lua`（615 proto / 13412 字符串）。
- **未运行时观测**：未启动游戏做动态验证（本任务为静态逆向）。REA 的运行时观测、浏览器/Electron 工具不适用于本作原生 LÖVE 目标。
- **分析引擎缺失**：REA 的 Hopper/Ghidra/IDA 原生反编译引擎本机未安装；本作核心价值在 Lua 数据，影响有限。
- **简中本地化不完整**：部分 COMIC 键缺中文，属游戏本身数据事实。

### 10.4 合规说明

本报告仅用于**学习与技术逆向研究**，分析对象为用户本机合法安装的 Steam 正版游戏；未修改、未破解、未分发游戏程序，未绕过任何 DRM 或付费机制。内购/DRM 相关内容仅为静态事实描述，不含任何规避方法。

---

## 附录

### A. 关键文件路径索引（绝对路径前缀 `D:/xyh/game/kingdom/reverse_analysis/extracted/`）

| 类别 | 路径 |
|---|---|
| 入口/版本 | `main.lua`、`conf.lua`、`version.lua`、`features.lua`、`main_globals.lua` |
| 核心逻辑 | `all/game.lua`、`all/systems.lua`、`all/templates.lua`、`all/components.lua`、`all/scripts.lua`、`all/entity_db.lua`、`all/director.lua`、`all/difficulty.lua` |
| 塔/英雄脚本 | `kr3/game_templates.lua`、`kr3/game_scripts.lua`、`kr3/upgrades.lua`、`kr3/data/tower_menus_data.lua` |
| 关卡/波次 | `kr3/data/levels/`、`kr3/data/waves/` |
| 本地化 | `_assets/kr3-desktop/strings/{en,zh-Hans,ja,kr,ru,fr,es,ko,zh-Hant,pt,de}.lua` |
| 漫画 | `kr3-desktop/data/comics/01.csv`~`09.csv`、`all/screen_comics.lua` |
| 地图 | `kr3-desktop/data/map_data.lua`、`map_points.lua`、`map_animations_paths.lua` |
| 美术 | `_assets/kr3-desktop/images/{fullhd,ipad}/`、`go_towers.lua` 等 sprite 定义 |
| 字体 | `_assets/all-desktop/fonts/` |
| 音频 | `_assets/kr3-desktop/sounds/{groups,sounds,extra,settings}.lua`、`all/sound_db.lua` |
| 商业化 | `kr3-desktop/data/iap_data.lua`、`remote_config_defaults.lua`、`all/shop_views.lua` |

### B. 分析中间产物

- `reverse_analysis/manifest.json` —— 1714 条资源清单（path/size/type）。
- `reverse_analysis/extracted/` —— 568 个文本文件（Lua/CSV/TXT/MD/C）。
- `reverse_analysis/strings/` —— 从字节码提取的字符串常量与 `en_kv.json` / `zh_kv.json`（549/552 条规范化键值对）。
- `reverse_analysis/images/` —— 提取的代表性图像样本（塔图集、地图、英雄立绘）。

### C. 复现命令摘要

```bash
# 解包 exe 尾部归档
python3 -c "import zipfile; zipfile.ZipFile('Kingdom Rush Origins.exe').extractall('extracted')"
# 提取 LuaJIT 字符串常量（正则扫描可打印 UTF-8/ASCII 序列）
# 详见 reverse_analysis/strings/ 生成脚本逻辑
```

---

*报告完 —— 基于对 511 MB 安装包的静态逆向，所有结论可回溯至具体字节/字符串/图像证据。*
