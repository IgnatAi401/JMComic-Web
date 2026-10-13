# 项目说明

- 用中文沟通，用户是初学者，给出可直接执行的命令。
- JMComic Web：纯静态 JM 漫画阅读站（原生 HTML/CSS/JS，ES modules），无后端、无构建步骤、无包管理依赖；浏览器直连 JM 官方服务器。
- `README.md` 面向访问仓库的用户，不写开发说明，不要随意更改。
- `/Users/ignat/Developer/JMComic-Next` 是同源项目，带 Python 后端实现（登录、本地资料库等）；本项目由它衍生，可参考其实现，但不要在本仓库引用或提交它的文件。

## 约定

- 不要擅自写更新日志（`src/data/changelog.js`），由用户自己决定写什么。
- 不要擅自提交或推送改动，由用户自己提交。推送到 `main` 会自动部署上线。

## 结构

- `*.html`：各页面入口（首页、最新、分类、搜索、书架、章节、阅读器、设置）。
- `src/pages/`：每个页面对应的入口脚本。
- `src/ui/`：共享界面组件；`src/reader/`：阅读器图片加载与切图。
- `src/api/`：JM 接口请求与解密；`src/data/`：本地书架、数据备份、更新日志。
- `src/core/`、`src/utils/`：设置与通用工具（浏览器存储、缓存、过滤等）。
- `style/`：样式；`image/`：图片资源。

## 部署

- `.github/workflows/deploy.yml`：推送 `main` 后把站点文件复制到 `_site/`，用 Wrangler 以静态资源部署到 Cloudflare Workers（`jm.ignat.ai`），配置见 `wrangler.toml`。
