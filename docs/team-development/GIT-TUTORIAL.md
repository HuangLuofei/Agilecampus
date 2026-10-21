# AgileCampus 五人 Git 协作教程

这份教程按第一次使用 Git 的同学来写。五个人可以同时开发：每个人在自己的功能分支上工作，完成后提交 Pull Request，由集成负责人审核并合并。不要直接修改或推送 `main`。

## 0. 先理解几个名词

- **远程仓库**：GitHub 上的 `https://github.com/HuangLuofei/Agilecampus`。
- **本地仓库**：电脑上的项目文件夹，以及其中隐藏的 `.git` 目录。
- **分支（branch）**：同一份代码的独立工作线。每个人使用自己的 `feature/...` 分支。
- **提交（commit）**：一次有说明的本地保存点。
- **推送（push）**：把本地提交上传到 GitHub。
- **拉取（pull）**：把远程最新提交合并到当前分支。
- **Pull Request（PR）**：请求把一个功能分支合并到 `main` 的网页审核流程。

## 1. 安装并检查工具

Windows、macOS 或 Linux 都可以使用 Git。安装后打开终端，依次执行：

```bash
git --version
node --version
npm --version
```

项目当前使用 Next.js 16、React 19、TypeScript 和 npm。若某人的 Node 版本和其他人差异很大，先统一到项目要求的版本，再安装依赖。

第一次使用 Git 的同学还要设置提交身份。姓名可以使用真实姓名，邮箱建议使用 GitHub 账号绑定的邮箱：

```bash
git config --global user.name "你的姓名"
git config --global user.email "你的GitHub邮箱"
git config --global init.defaultBranch main
```

检查配置：

```bash
git config --global --list
```

## 2. 确认 GitHub 协作者权限

仓库管理员需要在 GitHub 打开仓库的 **Settings → Collaborators**，邀请另外四位成员。每个人接受邀请后，才能正常拉取和推送分支。

建议所有人先登录自己的 GitHub 账号，并确认浏览器能打开仓库地址。第一次执行 `git clone` 或 `git push` 时，GitHub 可能要求浏览器登录、Personal Access Token（PAT）或 SSH 密钥。不要把密码、PAT 或 SSH 私钥发到聊天和代码仓库中。

## 3. 第一次获取项目：优先使用 clone

当前电脑上的 `Agilecampus-main` 目录没有 `.git`，它不是一个本地 Git 仓库。因此第一次协作不要在这个旧目录里直接执行 `git init`，也不要把旧目录直接推成新仓库。推荐重新 clone：

```bash
cd ~/Desktop
git clone https://github.com/HuangLuofei/Agilecampus.git Agilecampus
cd Agilecampus
```

如果 GitHub 使用 SSH，也可以使用：

```bash
git clone git@github.com:HuangLuofei/Agilecampus.git Agilecampus
cd Agilecampus
```

确认 clone 成功：

```bash
git remote -v
git status
```

`git remote -v` 应该显示 GitHub 地址，`git status` 应该显示当前分支和工作区状态。

如果电脑里已经有一个包含本地修改的旧项目目录，请先复制或备份需要保留的文件，再把修改逐个移到新 clone 的目录。不要把 `.env`、`node_modules`、数据库文件或 `public/uploads` 复制进去。

## 4. 使用当前共享主分支 main

截至本次上传，远程使用 `main` 接收功能 PR，没有单独的集成分支。五个人都从最新 `origin/main` 开始，分别创建自己的功能分支；不要重复创建或直接推送共享主分支。后续若团队改用独立集成分支，再共同调整约定。

以后五个人都从远程 `main` 创建自己的功能分支。分支名使用英文、小写和短横线，格式为：

```text
feature/member-1-invites
feature/member-2-weekly-report
feature/member-3-task-dependencies
feature/member-4-chat-preferences
feature/member-5-workbench
```

每个人执行自己的命令（下面以成员 1 为例）：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feature/member-1-invites
git push -u origin feature/member-1-invites
```

`-u` 会记录本地分支对应的远程分支，之后直接使用 `git push` 和 `git pull` 即可。

## 5. 每天开始工作前

先确认自己没有停留在别人的分支：

```bash
git branch --show-current
git status
```

然后同步远程信息，并把最新 `main` 合并到自己的功能分支。假设当前分支是 `feature/member-1-invites`：

```bash
git fetch origin
git switch feature/member-1-invites
git merge origin/main
```

如果工作区有未提交修改，先提交，或使用 `git stash` 临时保存后再合并。不要在有未保存重要修改时随意执行合并。

也可以使用 rebase，但第一次协作建议统一使用 `merge`，更容易理解，也不会改写已经推送的提交历史。

## 6. 日常修改、提交和推送

一次提交只表达一个清晰的工作单元。例如“增加邀请链接”，不要把无关的格式化、临时调试和其他功能混进同一个提交。

```bash
git status
git diff
git add src/lib/team.ts src/app/'(app)'/teams
git diff --cached
git commit -m "feat: add team invite links"
git push
```

如果文件路径包含括号、空格或特殊字符，要按终端实际规则加引号。也可以先使用 `git add -p` 逐块选择修改。

提交信息建议使用统一前缀：

```text
feat: 新功能
fix: 修复问题
refactor: 重构
test: 测试
docs: 文档
chore: 工具或配置
```

推送前查看自己要上传的提交：

```bash
git log --oneline origin/main..HEAD
git status
```

## 7. 创建 Pull Request

功能完成并通过本地检查后：

```bash
git push
```

打开 GitHub 仓库，进入 **Pull requests → New pull request**：

1. `base` 选择 `main`。
2. `compare` 选择自己的 `feature/...` 分支。
3. 标题写清功能，例如 `feat: add unread sorting and pinned groups`。
4. 描述至少包含：完成了什么、数据库是否变化、运行了哪些检查、已知限制、需要谁重点审核。
5. 指定集成负责人和相关成员为 reviewer。

PR 尚未审核通过前，继续修改时仍然在同一个功能分支上提交并 `git push`，PR 会自动更新。不要为了“让 PR 变干净”而强制推送已共享分支。

建议启用分支保护：`main` 禁止直接推送，要求 PR、至少一名审核者和通过检查后才能合并。

## 8. 处理 PR 合并前的冲突

如果 GitHub 提示分支落后于 `main`，在本地功能分支处理：

```bash
git fetch origin
git switch feature/member-1-invites
git merge origin/main
```

Git 会标记冲突文件。打开冲突文件，寻找：

```text
    <<<<<<< HEAD
你的分支内容
    =======
main 的内容
    >>>>>>> origin/main
```

结合两边需求编辑成最终内容，并删除这些标记。然后执行：

```bash
git status
git add 冲突文件路径
git commit -m "merge: resolve main conflicts"
git push
```

如果发现自己还没有能力判断冲突，先不要随意选择一边，保留现场并请集成负责人一起看。冲突解决后要重新运行受影响的测试。

## 9. 特别注意 schema 和共享文件冲突

五个人都可能修改 `src/db/schema.ts`、`tests/helpers.ts`、共享类型或样式。这些文件冲突时：

- 双方新增的表、字段、索引和枚举都要保留。
- 检查字段类型、默认值、唯一约束、外键和 `onDelete`。
- 检查迁移或 `db:push` 顺序，不要只让 TypeScript 编译通过。
- 测试清理脚本要删除新增表，避免测试污染开发库。
- 在 PR 描述中列出数据库变化和迁移方式。

成员 5 负责最终集成，但字段设计应由实际功能负责人解释清楚。不要因为冲突难解决就删除另一人的表或字段。

## 10. 环境变量和不应上传的文件

确认 `.gitignore` 包含以下类型：

```text
.env
.env.*
!.env.example
node_modules/
public/uploads/
*.db
```

可以提交不含密钥的 `.env.example`，例如只保留变量名和说明。绝不要提交真实数据库密码、Auth 密钥、AI API Key、PAT、私钥或用户上传文件。

提交前检查：

```bash
git status --short
git diff --cached --name-only
```

如果密钥已经被提交，立即停止继续推送，通知仓库管理员撤销并更换密钥；仅删除工作区文件并不能让已经进入 Git 历史的密钥失效。

## 11. 本地检查命令

在创建 PR 前，至少执行：

```bash
npm install
npm run lint
npx tsc --noEmit
npm test
npm run build
```

数据库结构变化后，按项目脚本使用开发库和测试库：

```bash
npm run db:push
npm run db:push:test
```

测试连接必须指向测试数据库，不能把测试清理操作运行在日常开发库上。

## 12. 常见问题

### 我不知道自己在哪个分支

```bash
git branch --show-current
git status
```

### 我把代码改在了 main 上

如果还没有提交，可以从当前修改创建功能分支：

```bash
git switch -c feature/你的功能名
```

如果已经提交到本地 `main`，先不要推送，联系集成负责人协助把提交移动到功能分支。

### `git push` 被拒绝

先执行：

```bash
git fetch origin
git status
git branch -vv
```

确认远程分支名、GitHub 协作者权限和登录状态。不要直接使用 `git push --force`。共享分支即使需要修正，也先联系集成负责人。

### 我想放弃未提交的修改

`git restore` 会丢弃指定文件的未提交修改，属于有风险操作。确认文件和内容后再使用：

```bash
git diff -- src/path/to/file
git restore -- src/path/to/file
```

不要使用 `git reset --hard` 清理整个项目，除非团队明确确认并且已经备份需要保留的内容。

### 我想把别人的最新代码拿到自己的分支

```bash
git fetch origin
git switch feature/你的功能名
git merge origin/main
```

合并后重新运行相关测试，再继续开发。

## 13. 五人每天都遵守的最短流程

```bash
git switch feature/自己的分支
git fetch origin
git merge origin/main
# 修改代码
git status
git diff
git add 相关文件
git commit -m "feat: 描述这次修改"
git push
```

完成后在 PR 中说明测试结果，等待审核。合并到 `main` 后，继续开发前再次执行 `git fetch origin` 和 `git merge origin/main`，这样五个人就能并行推进而不会互相覆盖工作。
