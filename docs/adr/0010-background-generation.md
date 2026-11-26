# 后台生成：刷新/断开页面不中止

2026-11-22 用户反馈"模型回复时刷新页面会提示已停止生成"。原设计把客户端断开视为停止，刷新即中断，体验不合理。

改为后台生成模式：
- 生成开始即保存 `assistant status = 'streaming'` 消息，`activeGenerations` 注册中止控制器；客户端断开只影响展示，不再中止生成。
- 增量通过 `setInterval` 每秒持久化（即使生成暂时无新 delta 也能保存进度），刷新后可见已生成部分。
- 完成/停止/失败时更新同一 streaming 消息为 complete/stopped/error。
- 新增 `POST /api/chats/:id/stop`：仅显式停止接口可中止（停止按钮改为调用它），返回 409 not-generating 表示无活跃生成。
- 前端加载会话时若最后一条 assistant 为 streaming，自动轮询（2s）恢复进度直到完成。

## Consequences

- 停止语义从"断连即停"变为"显式停止才停"，生成中发送新消息仍视为停止（与既有交互一致）。
- 服务端进程重启会中断生成（内存中 activeGenerations 丢失）；重启后读取到遗留的 streaming 消息时，将其标记为 stopped，让前端结束轮询并允许重试。恢复时先取得生成锁再重读，避免覆盖正在收尾保存的内容。
- 轮询恢复期间禁止切换会话，停止按钮仍可中止。
