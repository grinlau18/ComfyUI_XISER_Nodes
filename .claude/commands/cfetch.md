# 网站访问快捷命令

使用Python requests库稳定访问外部网站，替代不稳定的WebFetch工具。

## 使用方法
```
/cfetch <URL> [analysis_type]
```

## 参数
- `URL`: 网站地址（支持http/https）
- `analysis_type`: 分析类型
  - `basic`: 基础信息（默认）
  - `full`: 完整分析
  - `structure`: 结构分析

## 示例
```
/cfetch https://www.example.com
/cfetch www.example.com full
/cfetch example.com structure
```

## 优势
- ✅ 比WebFetch工具更稳定
- ✅ 支持中文编码
- ✅ 自动处理重定向
- ✅ 减少token消耗
- ✅ 结构化信息提取

## 实现
基于 `web_fetch_tool.py`，使用Python requests和BeautifulSoup库。