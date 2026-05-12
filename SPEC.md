# 小红书图片工具 - 用户系统设计文档

## 1. 数据库设计

### 技术选型
- **SQLite** - 零配置、轻量级、够用

### 数据表结构

```sql
-- =============================================
-- 用户表
-- =============================================
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,        -- 用户名（唯一）
  password_hash TEXT NOT NULL,          -- 密码（bcrypt加密）
  points INTEGER DEFAULT 100,            -- 积分余额，默认100
  role TEXT DEFAULT 'user',             -- 角色：user/admin
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- 积分记录表
-- =============================================
CREATE TABLE point_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,                    -- recharge(充值) / consume(消费)
  amount INTEGER NOT NULL,               -- 变动数量
  balance INTEGER NOT NULL,              -- 变动后余额
  description TEXT,                      -- 描述
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- =============================================
-- 历史记录表（重构）
-- =============================================
CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,                    -- image(图片) / copy(文案)
  sub_type TEXT,                         -- generate(生成) / rewrite(改写)
  content TEXT,                          -- 文案内容
  image_url TEXT,                        -- 图片URL
  prompt TEXT,                           -- 提示词/主题
  ratio TEXT,                            -- 图片比例
  cost_points INTEGER,                    -- 消耗积分
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 索引
CREATE INDEX idx_history_user_id ON history(user_id);
CREATE INDEX idx_history_created_at ON history(created_at);
CREATE INDEX idx_point_logs_user_id ON point_logs(user_id);
```

---

## 2. API 接口设计

### 认证接口

| 方法 | 路径 | 说明 | 参数 |
|------|------|------|------|
| POST | `/api/auth/register` | 注册 | username, password |
| POST | `/api/auth/login` | 登录 | username, password |
| GET | `/api/auth/me` | 获取当前用户信息 | - |
| POST | `/api/auth/logout` | 登出 | - |

### 用户接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/user/points` | 获取积分余额 | user |
| GET | `/api/user/points/logs` | 获取积分记录 | user |
| GET | `/api/user/history` | 获取用户历史 | user |
| GET | `/api/user/history/search` | 搜索历史 | user |

### 管理员接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/admin/users` | 用户列表 | admin |
| POST | `/api/admin/users/recharge` | 充值积分 | admin |
| DELETE | `/api/admin/users/:id` | 删除用户 | admin |
| GET | `/api/admin/stats` | 统计数据 | admin |
| GET | `/api/admin/history` | 所有历史记录 | admin |
| DELETE | `/api/admin/history/:id` | 删除记录 | admin |

### 生成接口（改造）

| 方法 | 路径 | 说明 | 变化 |
|------|------|------|------|
| POST | `/generate` | 图片生成 | 需登录，扣积分 |
| POST | `/generate-copy` | 文案生成 | 需登录，扣积分 |
| POST | `/rewrite` | 文案改写 | 需登录，扣积分 |

---

## 3. 积分规则

| 操作 | 积分变化 | 说明 |
|------|----------|------|
| 注册 | +100 | 新用户赠送 |
| 图片生成 | -10/张 | 最多一次生成4张 |
| 文案生成 | -5 | 每次生成 |
| 文案改写 | -3 | 每次改写 |
| 图文一体 | -5 + 10/张 | 文案5积分，图片每张10积分 |
| 管理员充值 | 自定义 | 正数增加 |

---

## 4. 前端页面设计

### 页面结构

```
/
├── index.html          # 主页面（需登录）
├── login.html          # 登录页
├── register.html       # 注册页
├── admin.html          # 管理后台（admin专用）
├── css/
│   └── *.css
├── js/
│   ├── app.js          # 主应用逻辑
│   ├── auth.js         # 认证逻辑
│   └── admin.js        # 管理后台逻辑
└── server.js           # 后端服务
```

### 主页面布局

```
┌─────────────────────────────────────────────┐
│  [Logo] 御弟哥哥工具          [积分: 85] [用户▼] │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─ 图片生成 ─┐    ┌─ 文案生成 ─┐           │
│  │  描述输入   │    │  主题输入   │           │
│  │  比例选择   │    │  类型选择   │           │
│  │  风格选择   │    │  [生成]    │           │
│  │  [生成]    │    └────────────┘           │
│  └────────────┘                            │
│                                             │
│  ┌─ 历史记录 ────────────── [搜索] [筛选] ─┐ │
│  │  🔍 搜索...  [类型▼] [时间▼]            │ │
│  │  ┌────┐ ┌────┐ ┌────┐                  │ │
│  │  │img │ │doc │ │img │  ...             │ │
│  │  └────┘ └────┘ └────┘                  │ │
│  └─────────────────────────────────────────┘ │
│                                             │
└─────────────────────────────────────────────┘
```

### 管理后台布局

```
┌─────────────────────────────────────────────┐
│  管理后台            [御弟哥哥] [返回工具] [登出] │
├──────────┬──────────────────────────────────┤
│          │  ┌─ 数据概览 ─────────────────┐   │
│  用户管理 │  │ 总用户: 120  总积分: 5000  │   │
│  积分管理 │  │ 今日生成: 45  今日消费: 320 │   │
│  记录管理 │  └───────────────────────────┘   │
│  数据统计 │  ┌─ 用户列表 ───────────────┐   │
│          │  │  用户名  | 积分 | 操作    │   │
│          │  │  张三    | 85  | [充值]   │   │
│          │  │  李四    | 120 | [充值]   │   │
│          │  └───────────────────────────┘   │
└──────────┴──────────────────────────────────┘
```

---

## 5. 安全性设计

### 认证机制
- **JWT Token** - 无状态认证
- **Token 有效期** - 7天
- **密码加密** - bcrypt（自动加盐）

### 权限控制
- 中间件验证 Token
- 管理员接口额外验证 role === 'admin'
- 积分扣减使用事务，保证一致性

### 速率限制（保留）
- 图片生成：20次/分钟
- 文案生成：30次/分钟
- 注册/登录：10次/分钟

---

## 6. 文件改动清单

### 新增文件
```
├── db.js              # 数据库操作封装
├── routes/
│   ├── auth.js        # 认证路由
│   ├── user.js        # 用户路由
│   └── admin.js       # 管理员路由
├── middleware/
│   └── auth.js        # 认证中间件
├── public/
│   ├── login.html     # 登录页
│   ├── register.html  # 注册页
│   ├── admin.html     # 管理后台
│   └── js/
│       ├── auth.js    # 认证逻辑
│       └── admin.js   # 管理员逻辑
```

### 改造文件
```
├── server.js          # 重构路由结构
├── index.html         # 添加用户状态显示
├── script.js          # 添加登录态检查
└── style.css         # 添加登录页样式
```

---

## 7. 实施计划

| 阶段 | 任务 | 时间 |
|------|------|------|
| 1 | 数据库搭建 + 用户CRUD | 30min |
| 2 | JWT认证 + 注册登录 | 45min |
| 3 | 积分系统 + 扣积分 | 30min |
| 4 | 前端登录注册页 | 45min |
| 5 | 前端用户状态 + 积分显示 | 30min |
| 6 | 历史记录关联用户 | 30min |
| 7 | 历史搜索筛选 | 30min |
| 8 | 管理后台 + 用户管理 | 45min |
| 9 | 管理后台 + 充值功能 | 30min |
| 10 | 测试 + 修复 | 30min |

**总计：约 4-5 小时**

