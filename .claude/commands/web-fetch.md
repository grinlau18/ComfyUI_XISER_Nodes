# Web Fetch Command for Claude Code

## 功能
使用Python requests库高效访问外部网站，避免WebFetch工具的不稳定问题。

## 使用方法
```
/web-fetch <URL> [analysis_type]
```

## 参数
- `URL`: 要访问的网站地址（支持http/https）
- `analysis_type`: 分析类型（可选）
  - `basic`: 基础信息（默认）
  - `full`: 完整分析（包含导航、内容等）
  - `structure`: 结构分析（包含页面结构统计）

## 示例
```
/web-fetch https://www.example.com
/web-fetch www.example.com full
/web-fetch example.com structure
```

## 实现原理
1. 使用Python requests库进行HTTP请求
2. 使用BeautifulSoup解析HTML
3. 自动处理重定向和编码
4. 提取关键信息并格式化输出

## 优势
- ✅ 比WebFetch工具更稳定
- ✅ 支持中文网站编码
- ✅ 自动处理重定向
- ✅ 可自定义分析深度
- ✅ 减少token消耗

## 注意事项
- 需要安装Python requests和beautifulsoup4库
- 默认超时时间为10秒
- 会自动添加User-Agent头模拟浏览器访问