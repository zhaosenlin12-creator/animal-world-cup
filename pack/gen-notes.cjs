const fs = require("fs");
const c = require("crypto");

const h = (f) => c.createHash("sha256").update(fs.readFileSync("pack/dist/" + f)).digest("hex");
const s = h("DongwuZuqiu-Setup-1.0.0.exe");
const p = h("DongwuZuqiu-1.0.0-portable.exe");

const notes = [
  "## 动物足球（Animal Cup）Windows 桌面版 v1.0.0",
  "",
  "双击即玩的完整单机足球游戏：内置 Next 服务与局域网/本地房间中继，无需安装 Node、无需手动启动服务器。",
  "",
  "### 关于下载文件（重要）",
  "",
  "受发布链路对单个大文件的上传限制，两个安装包以 **8 MB 分片**形式提供，共 36 个 `.pNN` 文件。请下载本页**全部** `*.pNN` 分片与 `restore.cmd`，放到**同一个文件夹**，双击 `restore.cmd` 即可一键还原出下面两个完整 exe（字节级一致，可用 SHA-256 校验）。",
  "",
  "还原脚本等价于按文件名顺序把所有分片做二进制拼接，不会修改任何字节。",
  "",
  "### 还原后得到",
  "",
  "- **DongwuZuqiu-Setup-1.0.0.exe**（137 MB）：安装版，可自选目录、创建桌面/开始菜单快捷方式、卸载干净。推荐首次安装。",
  "- **DongwuZuqiu-1.0.0-portable.exe**（137 MB）：便携版，免安装双击即玩，删除即走。",
  "",
  "两者游戏内容一致，任选其一即可。",
  "",
  "### 操作",
  "",
  "从 8 支动物国家队选队、排阵型，点「开球」亲自操控或交由 AI 观赛。键盘：方向键 / WASD 移动、D 射门、A 传球、W 挑传、S 抢断、Q 换人、Shift 冲刺。同一 WiFi 下手机扫码可作为无线手柄。",
  "",
  "### 还原后 SHA-256 校验",
  "",
  "- Setup: `" + s + "`",
  "- Portable: `" + p + "`",
  "",
  "### 说明",
  "",
  "- 仅支持 Windows 10 / 11 x64。",
  "- 首次启动需解压内置服务，约十几秒，属正常现象。",
  "- 内置局域网 / 本地房间对战；跨公网对战需自行部署外部服务器。",
  "- 若任务栏仍显示旧图标，删除旧快捷方式并重启资源管理器即可刷新。",
  "",
  "对应源码提交 `cefc615`：Electron 打包脚本、键盘控制修复、standalone 构建开关。",
].join("\n");

fs.writeFileSync("pack/.release-notes-parts.md", notes);
fs.writeFileSync("pack/.release-patch.json", JSON.stringify({ body: notes }));
console.log("notes bytes=" + Buffer.byteLength(notes));
console.log("sha256_setup=" + s);
console.log("sha256_portable=" + p);
