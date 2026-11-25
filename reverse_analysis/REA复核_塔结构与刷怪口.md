# REA 复核报告：塔的分层结构与刷怪口路径语义

> 复核时间：2026-11-19
> 触发：用户反馈"怪物出生点和路线不对、塔模型不对"，并要求用 REA 复核原游戏是否有细节遗漏。
> 复核手段：LuaJIT 字节码反编译产物（`decompiled/`）+ fullhd 原始图集（`atlas_fullhd/`）+ 波次/路径数据交叉验证。

## 结论：此前逆向报告确有两处重要细节遗漏

原始《KRO_逆向分析报告.md》正确还原了"4 大塔系 + 8 座四级塔"的**玩法框架**，但对以下**视觉/关卡数据的实现细节**未展开，导致小游戏复刻时出错：

---

## 遗漏点 1：每座塔是「塔基 + 塔顶单位」的分层结构

### 原作事实（反编译 + 图集证据）
从 `decompiled/atlas/go_towers.lua` 与 fullhd 图集确认，每座塔由**两层独立精灵**组成：

| 塔系 | 塔基（go_towers-1.png，建筑本体） | 塔顶单位（go_towers-2/3.png，站在塔顶的人物） |
|---|---|---|
| 弓箭 Archer | `archer_towers`（树屋平台） | `archer_silver_shooter`（银箭射手，99 帧）、`archer_arcane_shooter`（奥术射手） |
| 法师 Mage | `mage_towers_layer1`（石质基座） | `mage_wild_shooter`（荒野法师，88 帧）、`mage_tower_shooter` |
| 投石/德鲁伊 | `artillery_base`（投石机基座） | `artillery_thrower`（投石德鲁伊，49 帧）、`artillery_henge_druid1/2/3` |
| 兵营 Barracks | `barracks_towers_layer1`（石砌营门） | `soldiers_123`（3 人小队，75 帧）、`bladeSinger`（武僧，79 帧） |

- **攻击塔**：塔基上站着远程单位，单位有站立/瞄准/射击的逐帧动作（图集联络图确认帧 1~N 为弓手拉弓/法师施法/德鲁伊投石）。
- **兵营塔**：塔基是营门，塔顶是 3 名士兵；原作中士兵会**从塔门走出，站到道路旁待命**，敌人经过时触发近战阻挡（对应字符串证据中的 blocking/rally 机制）。

### 此前错误
小游戏只取了塔顶单位帧（如 `archer_silver_shooter`）当整座塔绘制，**完全没有塔基**，也没有兵营的 3 名士兵 —— 因此用户看到"塔模型不对、攻击动作未复刻、没有防御人员"。

### 修复
- 新增 `tools/cut_tower_parts.js`：从 fullhd 图集切出 4 个塔基 + 4 类塔顶单位（各 6 帧动作）+ 兵营 3 士兵。
- `engine.js drawTower()` 改为**分层渲染**：塔基在底部，塔顶人物站在塔顶平台并播放攻击动作帧；兵营塔额外在塔旁道路渲染 3 名士兵待命。

---

## 遗漏点 2：波次路径是「主刷怪口 path_index + 子路径 path」两层结构

### 原作事实（波次数据证据）
`decompiled/waves/level01_waves_campaign.lua` 中每条 spawn 有两个路径字段：
- `path_index`（1..N）= **主路径 / 刷怪口**，对应 `level01_paths.lua` 中 `active={true,true}` 的两条主路径，即**第一关右侧上下两个岔路口**。
- `path`（1..3）+ `fixed_sub_path` = **子路径 / 车道偏移**，只在同一刷怪口内分散敌人站位，不是刷怪口。

第一关 campaign 各波的刷怪口分配（验证用户描述完全正确）：

| 波次 | path_index（刷怪口） |
|---|---|
| 波 1、2 | 仅口 1（右侧岔路口 A） |
| 波 3 | 仅口 2（右侧岔路口 B） |
| 波 4、5、6 | 口 1 + 口 2 同时 |

两条主路径均从右侧 x≈970 出发、向左行进到左侧 x≈-176（映射到 1000×600 逻辑坐标），即**从右往左沿土路前进**。

### 此前错误
`engine.js buildWave()` 错误地用 `sp.path`（子路径 1/2/3）当路径索引，导致：
- 本应从岔路口 A 出的敌人被分到不存在索引而钳制到口 0；
- 两个刷怪口的波次分配与原作完全不符。

### 修复
- `buildWave()` 改用 `wv.path_index` 决定主刷怪口；`sp.path` 降级为同口内的**车道纵向偏移**（lane = path-2 → -1/0/+1）。
- `spawnEnemy()` 与 `updateEnemies()` 应用 lane 偏移，敌人从正确岔路口出生并沿对应土路从右往左前进。

---

## 复核方法留痕
- 反编译产物：`reverse_analysis/decompiled/levels/level01_paths.lua`、`decompiled/waves/level01_waves_*.lua`、`decompiled/atlas/go_towers.lua`
- 原始图集：`reverse_analysis/atlas_fullhd/go_towers-1/2/3.png`（2048×2048 fullhd，坐标系与 f_quad 一致）
- 切帧工具：`reverse_analysis/tools/cut_tower_parts.js`、`pnglib.js`
- 视觉验证：`_shots/tower_archer_sheet.png`（帧联络图，确认人物动作帧）、`_shots/tower_parts_overview.png`（8 部件总览）

## 已同步更新
- `js/sprite_manifest.js`：新增 4 塔基 + 4 塔顶单位帧序列 + 兵营旗帜，共 137 条目
- `js/engine.js`：分层塔渲染 + 双层路径刷怪逻辑
- `js/scenes.js`：聚合 `top_*_fN` 动画帧
