#!/usr/bin/env python3
"""
网站访问工具 - 为Claude Code提供稳定的外部网站访问功能
"""

import requests
from bs4 import BeautifulSoup
import json
import sys
from urllib.parse import urljoin
import re

class WebFetchTool:
    """网站访问工具类"""

    def __init__(self, timeout=10):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
        })

    def fetch_url(self, url, analysis_type='basic'):
        """
        获取URL内容

        Args:
            url: 要访问的URL
            analysis_type: 分析类型 ('basic', 'full', 'structure')

        Returns:
            dict: 包含网站信息的字典
        """
        try:
            # 确保URL有协议
            if not url.startswith(('http://', 'https://')):
                url = 'https://' + url

            response = self.session.get(url, timeout=self.timeout, allow_redirects=True)
            response.raise_for_status()

            result = {
                'success': True,
                'url': response.url,
                'status_code': response.status_code,
                'content_type': response.headers.get('content-type', ''),
                'content_length': len(response.text),
                'encoding': response.encoding,
            }

            # 根据分析类型添加更多信息
            if analysis_type in ['full', 'structure']:
                soup = BeautifulSoup(response.text, 'html.parser')

                # 基本元信息
                result['title'] = soup.title.string if soup.title else ''

                meta_desc = soup.find('meta', {'name': 'description'})
                result['description'] = meta_desc.get('content', '') if meta_desc else ''

                # 导航链接
                result['navigation'] = self._extract_navigation(soup)

                # 主要内容
                result['main_content'] = self._extract_main_content(soup)

                # 联系方式
                result['contact_info'] = self._extract_contact_info(response.text)

                # 页面结构
                if analysis_type == 'structure':
                    result['page_structure'] = self._analyze_structure(soup)

            return result

        except requests.exceptions.RequestException as e:
            return {
                'success': False,
                'error': str(e),
                'url': url
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'解析错误: {str(e)}',
                'url': url
            }

    def _extract_navigation(self, soup):
        """提取导航菜单"""
        nav_items = []

        # 查找导航元素
        nav_selectors = ['nav', '.nav', '.menu', '.navigation', 'header']
        for selector in nav_selectors:
            nav_elements = soup.select(selector)
            for nav in nav_elements:
                links = nav.find_all('a')
                for link in links:
                    text = link.get_text(strip=True)
                    href = link.get('href', '')
                    if text and href:
                        nav_items.append({
                            'text': text,
                            'href': href
                        })

        return nav_items[:20]  # 限制数量

    def _extract_main_content(self, soup):
        """提取主要内容"""
        content = []

        # 尝试查找主要内容区域
        main_selectors = ['main', 'article', '.content', '.main', '.post', '.entry']
        for selector in main_selectors:
            elements = soup.select(selector)
            for elem in elements[:3]:  # 只取前3个
                paragraphs = elem.find_all('p')
                for p in paragraphs[:5]:  # 每个区域取前5段
                    text = p.get_text(strip=True)
                    if text and len(text) > 10:
                        content.append(text[:300])  # 限制长度

        return content

    def _extract_contact_info(self, html_content):
        """提取联系方式"""
        contact = {}

        # 提取电话
        phone_patterns = [
            r'1[3-9]\d{9}',
            r'\d{3,4}[- ]?\d{7,8}',
            r'电话[：:]\s*([\d\- ]+)',
            r'手机[：:]\s*([\d\- ]+)',
            r'Tel[：:]\s*([\d\- ]+)',
            r'Phone[：:]\s*([\d\- ]+)'
        ]

        phones = set()
        for pattern in phone_patterns:
            matches = re.findall(pattern, html_content)
            for match in matches:
                if isinstance(match, tuple):
                    match = match[0]
                phones.add(match.strip())

        if phones:
            contact['phones'] = list(phones)

        # 提取邮箱
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        emails = set(re.findall(email_pattern, html_content))
        if emails:
            contact['emails'] = list(emails)

        return contact

    def _analyze_structure(self, soup):
        """分析页面结构"""
        structure = {
            'headings': {},
            'sections': [],
            'forms': [],
            'images': 0,
            'links': 0
        }

        # 统计标题
        for i in range(1, 7):
            headings = soup.find_all(f'h{i}')
            structure['headings'][f'h{i}'] = len(headings)

        # 统计图片
        structure['images'] = len(soup.find_all('img'))

        # 统计链接
        structure['links'] = len(soup.find_all('a'))

        return structure

def main():
    """命令行入口点"""
    if len(sys.argv) < 2:
        print("用法: python web_fetch_tool.py <URL> [analysis_type]")
        print("analysis_type: basic, full, structure (默认: basic)")
        sys.exit(1)

    url = sys.argv[1]
    analysis_type = sys.argv[2] if len(sys.argv) > 2 else 'basic'

    tool = WebFetchTool()
    result = tool.fetch_url(url, analysis_type)

    # 输出JSON格式结果
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()