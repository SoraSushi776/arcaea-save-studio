# Arcaea 存档工坊

一个本地运行的 Arcaea 存档工具：按目标 PTT 生成像真人的成绩、一键全理论 / 全空存档，以及导入 st3 逐条编辑后重新导出。

界面走 Material You（Material 3），后端 Node.js + Express，存档读写用 sql.js。

## 快速开始

```bash
cd arcaea-save-studio
npm install          # 首次运行
npm start            # 启动，默认 http://127.0.0.1:3456
```

然后浏览器打开 <http://127.0.0.1:3456>。

> npm 如果报缓存权限错误，加 `--cache ./.npm-cache` 装。

## 流程

打开就是「生成存档」——从 0 设计一份新档，不需要任何前置文件。

- 想改现成的档：切到「编辑存档」，导入 st3（拖入或点选，不限后缀），导入后自动跳到编辑视图
- 生成完想微调：点「载入编辑器微调」，把生成结果丢进编辑器逐条改

## 功能

### 1. 目标 PTT 生成

输入想要的 PTT，程序会：

1. 按定数挑出 50 个候选谱面，构造「前 10 名略高于其余」的 Best 50 形状；
2. 用二分把整体 PTT 校准到目标值（误差通常 < 0.0005）；
3. 把每个目标潜力值反推成自洽的分数与 PURE / SHINY / FAR / LOST 计数（不会全是 PM）；
4. 给其余谱面填充不会挤进 Best 50 的历史成绩。

可选参数：

- **填充范围**：全曲（默认，所有谱面都有成绩）/ 仅 Best50（只写那 50 条）
- **通关奖励**：0.2（社区资料口径）/ 0.15（实测校准口径，和游戏显示更接近）
- **随机种子**：同一个种子 + 同一个目标，结果可复现

### 2. 全理论 / 全空

- **全理论**：所有谱面 Pure Memory，物量全吃满（分数 = 10,000,000 + 物量）
- **全空**：0 条成绩的空存档

三种结果都能直接导出 st3。

### 3. 存档修改器

导入 st3 后：

- 表格按单曲潜力排序，支持搜索、分页
- 点「编辑」改分数 / PURE / SHINY / FAR / LOST / 通关状态，单曲 PTT 实时重算
- 顶部实时显示整体 PTT、Best50 / Best10 总和
- 随时导出新的 st3

## PTT 算法

单曲潜力值：

```
score ≥ 10,000,000                 → 定数 + 2 + 奖励
9,800,000 ≤ score < 10,000,000     → 定数 + 1 + (score - 9,800,000) / 200,000 + 奖励
score < 9,800,000                  → max(0, 定数 + (score - 9,500,000) / 300,000 + 奖励)
```

奖励：PM / FR / 各种通关给，Track Lost 不给。

整体潜力值：

```
PTT = (Best50 总和 + Best10 总和) / 60
```

Best50 取历史最高的 50 个单曲潜力值（同一谱面只计一次），前 10 个再计一遍。

## 目录

```
server/
  index.js      HTTP 服务与 API
  data.js       曲目 / 谱面目录（songlist + 定数 + 物量）
  ptt.js        潜力值计算与分数反推
  save.js       st3（SQLite）读写
  generator.js  目标 PTT / 全理论 / 全空生成
data/           songlist.json、constants.json、chartmeta.json
public/         前端（index.html / app.js / styles.css）+ Material Web 组件
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/meta` | 谱面总数、理论最高 PTT |
| GET | `/api/catalog` | 全部谱面 |
| POST | `/api/load` | 上传 st3（base64），返回成绩与 PTT |
| POST | `/api/summary` | 按记录数组计算 PTT |
| POST | `/api/generate` | `{mode:"ptt"\|"theory"\|"empty", target, fill, seed, bonus}` |
| POST | `/api/export` | 记录数组 → st3 文件 |

## 数据来源

曲目表、物量、定数来自社区维护的 Arcaea 数据（songlist 7.1.0）。导出的 st3 与游戏内 SQLite 结构一致（`scores` / `cleartypes` / `purchases` / `schemaversion`）。

## 注意

- 改档前务必备份原 st3；上传服务器可能被判定异常，仅建议本地使用。
- 工具只负责生成本地存档，不涉及联网。
