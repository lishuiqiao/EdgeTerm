<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.png">
    <img src="docs/logo.png" alt="EdgeTerm" width="480">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/miskin-lee/EdgeTerm/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/miskin-lee/EdgeTerm?style=flat"></a>
  <a href="https://qm.qq.com/q/oINZ2ffDOg"><img alt="加入 EdgeTerm QQ 群：1129162865" src="https://img.shields.io/badge/QQ%20group-Join%20discussion-12B7F5?style=flat"></a>
  <a href="https://github.com/lishuiqiao/EdgeTerm/releases"><img alt="GitHub release downloads" src="https://img.shields.io/github/downloads/lishuiqiao/EdgeTerm/total?style=flat&amp;label=downloads"></a>
  <a href="https://github.com/lishuiqiao/EdgeTerm/releases/latest"><img alt="最新 GitHub 发布版本" src="https://img.shields.io/github/v/release/lishuiqiao/EdgeTerm?style=flat"></a>
  <a href="LICENSE"><img alt="GPL-3.0 许可证" src="https://img.shields.io/github/license/miskin-lee/EdgeTerm?style=flat"></a>
  <a href="https://github.com/miskin-lee/EdgeTerm/graphs/contributors"><img alt="GitHub 贡献者" src="https://img.shields.io/github/contributors/miskin-lee/EdgeTerm?style=flat"></a>
</p>

[English](README.md) | [简体中文](README.zh-CN.md)

小巧、快速的终端 / SSH / Telnet / SFTP / FTP / 串口客户端，基于 **Rust + Tauri**，安装包约 4–5 MB。

> [!TIP]
> <a href="https://github.com/miskin-lee/serialX"><img src="https://raw.githubusercontent.com/miskin-lee/serialX/main/assets/icons/png/serialx-64.png" alt="serialX" width="20" height="20" align="top"></a> 做嵌入式开发、需要用串口调试设备？推荐使用同一作者的 **[serialX](https://github.com/miskin-lee/serialX)**，一款专为串口调试打造的工作台。

<img src="docs/screenshot-dark.png" alt="EdgeTerm 深色主题：分栏、着色的日志与交换机输出、会话树、Filer 与 Sender" width="100%">

<img src="docs/screenshot-light.png" alt="EdgeTerm 浅色主题：同一工作区" width="100%">

## 功能

- **会话**：本地 Shell、SSH、Telnet、SFTP、FTP、串口，分组树管理，可筛选、复制，也可从 `~/.ssh/config` 导入。
- **SSH**：密码、公钥、ssh-agent、keyboard-interactive（MFA / 验证码）、跳板机，也能连只支持旧算法的网络设备。
- **易读的输出**：时间戳与行号栏，IP、URL、日志级别、HTTP 方法、路径、容量等语义着色。
- **分栏与标签**：向右 / 向下分栏，标签可在分栏间拖动，后台标签的运行 / 完成状态一眼可见。
- **Filer**：通过 SFTP、FTP 或本地磁盘浏览文件，支持与桌面之间双向拖拽。
- **Sender**：保存常用命令和多行脚本，发送到当前会话或全部会话，可定时重复。
- **终端内文件传输**：ZMODEM（`rz` / `sz`）与 XMODEM。
- **日常细节**：主题、字体、光标样式，自定义编码与 locale，会话录制，选中即复制，多行粘贴提醒，快捷键可改，全部设置可导出 / 导入。

## 安装

从 [Releases](https://github.com/lishuiqiao/EdgeTerm/releases) 下载：

| 平台 | 安装包 |
| --- | --- |
| Windows x64 | 安装程序（`.exe`）或便携版 `.zip` |
| macOS Apple Silicon | `.dmg` |
| Linux x64 / ARM64 | `.AppImage`、`.deb` 或 `.rpm` |

- 未做 macOS 公证和 Windows Authenticode 签名，首次打开时系统可能会提示风险。
- 便携版的数据都存在 `EdgeTerm.exe` 旁的 `data` 文件夹里；直接复制到其他机器无法解密保存的密码，迁移凭据请使用下方的加密导出与导入。
- `.rpm` 需要 WebKitGTK 4.1（Fedora 有），较老的发行版请用 AppImage。
- 安装版会自动更新（**Help → Check for Updates…**），便携版只提示有新版本。

## 自动更新

此 fork 使用独立的更新签名密钥，并从 `lishuiqiao/EdgeTerm` 的 Releases
获取更新。首次使用此更新渠道需要安装本 fork 的安装包；上游安装版仍跟随上游渠道。

GitHub Actions 的 **Release** 流程会构建带更新签名的安装包，全部平台及更新清单
检查通过后才正式发布。仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY` 和
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 分别保存此 fork 的更新私钥和密码。
请妥善备份两者，不要提交到 Git；对应公钥和更新地址保存在 `src-tauri/tauri.conf.json`。

这些签名用于验证应用更新，不包含 Apple 公证或 Windows Authenticode 签名。

## 快速上手

1. **Session → New Session…**（`⌘N` / `Alt+N`）新建会话，在 Session 面板里双击连接；右键会话可编辑、复制、移动或删除。
2. 右侧 **Filer** 跟随当前标签：把文件拖进去即上传，拖出来即下载；`⌘J` / `Ctrl+Shift+J` 跳到 shell 的当前目录。点击“新建文件”左侧的放大镜，可搜索当前目录中的文件和文件夹名称（忽略大小写，不递归子目录），匹配文字会高亮。Enter / Shift+Enter 切换匹配，Esc 关闭。鼠标位于 Filer 内时，`⌘F` / `Ctrl+Shift+F` 打开文件搜索；其他区域打开终端文本搜索，`⌘G` / `Ctrl+Shift+G` 同样按鼠标位置切换下一个匹配。
3. 底部 **Sender** 把文本发到当前会话或全部会话，常用命令可存成标签。
4. 标签右键菜单和 **View** 里有 **Split Right / Split Down**，把标签拖到别的分栏即可移过去。
5. **Edit** 里是复制粘贴相关设置（右键行为、选中即复制、OSC 52），**View** 里是主题、字体和 **Keyboard Shortcuts…**。

### 连接后自动执行命令

新建或编辑 **SSH / Shell** 会话，在 **Startup command → Command** 中填写命令，支持多行；留空则不执行。**Startup delay (ms)** 是执行前的等待时间，默认 500 毫秒，可设为 0。每次打开、重连或复制会话执行一次，切换标签页不会重复执行；延迟期间关闭会话会取消执行。

SSH 会话在服务器接受远程 Shell 后开始计时，本地 Shell 在进程启动后开始计时。命令按终端输入发送，换行视为回车，最后一行自动提交。延迟不会检测提示符或等待每条命令完成；启动较慢时请增加延迟。命令随会话保存及导出。

通过 AWS Session Manager / `ProxyCommand` 连接时，可先在系统 SSH 配置中设置主机别名，再新建 **Shell** 会话，把启动命令填为 `ssh my-aws-host`（替换成你的别名）。它会调用本地 OpenSSH，使用本机已有的 SSH 配置和 AWS 工具。这仍是本地 Shell 会话，内置远程 SFTP 面板不会随之连接；内置 SSH 的原生 `ProxyCommand` 支持不在此功能内。

## 配置备份与迁移

在 **Session → Export Data…** 中导出会话、分组、Sender 命令和界面设置。默认生成不含登录密码及私钥密码的明文 JSON 文件，扩展名为 `.edgeterm`。

勾选 **Include login passwords and private key passphrases**，设置并确认至少 8 个字符的导出密码，即可生成包含已保存凭据的整文件加密备份。导出密码不会保存到应用设置；遗忘后无法恢复。私钥文件本身不包含在内，需要另外复制，并按目标设备调整路径。Shell 中使用的 OpenSSH / AWS 配置和凭据也需要单独配置。

在另一台设备选择 **Session → Import Data…**，打开备份，输入导出密码并点击 **Unlock**。核对预览后点击 **Import**，凭据会用目标设备的本地密钥重新加密保存。相同 ID 的条目会更新，其他条目不会删除；备份中提供的凭据覆盖对应本地凭据，没有提供的则保留本地值。

旧明文文件仍可导入，文件中手动添加的密码字段会被忽略。加密备份需要支持此功能的版本才能导入。备份使用 PBKDF2-HMAC-SHA256（600,000 次、随机盐）派生密钥，以 ChaCha20-Poly1305 加密并校验完整性；密码错误、文件被篡改，或确认前文件已更换时拒绝导入。

## 快捷键

| macOS | Windows / Linux | 作用 |
| --- | --- | --- |
| `⌘N` | `Alt+N` | 新建会话 |
| `⌘W` | `Ctrl+Shift+W` | 关闭会话 |
| `⌘F` / `⌘G` | `Ctrl+Shift+F` / `Ctrl+Shift+G` | 查找 / 查找下一个 |
| `⌥⌘C` / `⌥⌘W` / `⌥⌘R` / `⌥⌘L` | `Alt+C` / `W` / `R` / `L` | 查找框内：区分大小写 / 全字匹配 / 正则表达式 / 在选区中查找 |
| `⌘K` | `Alt+K` | 清屏 |
| `⌘J` | `Ctrl+Shift+J` | 在 Filer 中显示当前目录 |
| `⌘[` / `⌘]` | `Alt+[` / `Alt+]` | 上一个 / 下一个标签 |
| `⌘1`–`⌘9` | `Alt+1`–`Alt+9` | 切到第 N 个标签 |
| `⌘\` / `⌘⇧\` | `Ctrl+Shift+\` / `Ctrl+Alt+\` | 向右 / 向下分栏 |
| `⌘⌥[` / `⌘⌥]` | `Ctrl+Alt+[` / `Ctrl+Alt+]` | 上一个 / 下一个分栏 |
| `⌘⌥←` / `⌘⌥→` / `⌘⌥↓` | `Ctrl+Alt+←` / `→` / `↓` | 显示 / 隐藏 Session、Filer、Sender |
| `⌘C` / `⌘V` / `⌘A` | `Ctrl+Shift+C` / `V` / `A` | 复制 / 粘贴 / 全选 |

上表中的应用动作除标签序号键和搜索框自身的按键外，都可在 **View → Keyboard Shortcuts…** 中修改。另支持 WindTerm 的复制粘贴、前后搜索、滚动、字号调整和两段式窗口快捷键，详情见[快捷键对照与验证](docs/windterm-keyboard-audit.md)。列表获得焦点后，Filer / FTP / SFTP 支持 F2 重命名、F5 刷新、Delete 确认删除等；Sender 支持 Alt+Enter 发送、Alt+Q 停止、Alt+X 清空。

macOS 的 Fn+←/→ 在普通 Shell 屏幕中默认移动到输入行首/尾。全屏或 application-cursor 模式保持标准终端序列；需要完全标准的 Home/End 编码时，关闭 **Edit → Home/End Line Editing**。这不是 WindTerm 的独立本地 Vim 浏览模式。

## 许可证

EdgeTerm 采用 [GNU General Public License v3.0](LICENSE) 授权。

界面图标来自 Microsoft 的 [Codicons](https://github.com/microsoft/vscode-codicons)，依据 Creative Commons Attribution 4.0 许可使用。

应用名称“EdgeTerm”及其图标不在上述开源许可范围内，版权 © 2026 miskin，保留所有权利。

### AI 指令建议

在 **Edit → Command Suggestions** 下方打开 **AI Command Suggestions → Settings…**，配置 OpenAI 兼容 Chat Completions 的 API Base URL（如 `https://service.example/v1`）、模型和可选 API Key。可测试连接，Shell 类型可自动判断已知本地配置或手动选择；SSH 的远程 Shell 未知时不会假定与本机相同。开启 AI 建议会关闭历史 Command Suggestions，反之亦然。

在 Sender 或 SSH / Shell 终端输入需求或部分命令，按 **Ctrl+Shift+Space** 手动生成灰色预览。可在 **Keyboard Shortcuts → Generate AI Command** 中改键。**Tab 将原输入替换为建议，不执行**；Esc、编辑输入、移动光标、失焦或切换会话会丢弃预览及迟到的结果。修改不会重新请求，必须再次主动触发。原始文本保留到采用为止；没有 AI 预览时 Tab 保持原功能。

只发送本次输入和 Shell 类型，不发送历史输出或文件内容。第一版返回单行命令；Sender 可用多行描述需求。终端要求普通 Shell 提示符、输入回显已到达、光标在末尾且没有选区；交互程序、密码提示、未知提示符、复杂组合字符或行尾有其他文本时请用 Sender。终端替换针对常规行编辑模式，Shell vi 模式和自定义退格行为请改用 Sender。

API Key 在本地加密保存，普通备份及导入预览不含 Key；密码加密备份可以携带 Key。更换接口地址不会复用原接口的密钥。AI 请求超时或失败只显示错误，不重试、不执行命令。接口格式参考 [OpenAI Chat Completions 文档](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。

AI 设置支持“Additional rules”补充命令偏好（最多 4000 字符），固定输出规则不可编辑。返回必须是仅含 command 字段的 JSON，值为一行命令或 null；无效格式、明显解释文本、控制字符和截断结果会被丢弃，不自动重试。支持 JSON Schema 的服务可开启“Strict structured output”，其他兼容服务保持关闭，仍执行本地校验。结构校验不保证命令语义或安全，采用后仍需自行确认再执行。补充规则会随请求发送，也随配置导出。

上游功能整合：文件列表支持 Command 点击（其他平台为 Ctrl 点击）、Shift 点击多选及批量传输。Filer 搜索高亮与文件选择独立，修改搜索词不会改变待传输的选择；重命名/删除要求单选，远程列表的 F3 下载当前选择。终端搜索新增区分大小写、全词、正则和选区范围，并保留黄/青色醒目高亮。串口波特率使用主题下拉框，多会话标签拥挤时横向滚动。
