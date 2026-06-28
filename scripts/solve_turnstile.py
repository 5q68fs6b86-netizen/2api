#!/usr/bin/env python3
"""
Cloudflare Turnstile 自动求解器
基于 SeleniumBase UC Mode 自动点击 Turnstile 验证并提取 token

核心发现：Kombai 注册页使用 render=explicit 模式加载 Turnstile，
React 应用需要手动调用 turnstile.render() 渲染 widget。
本脚本检测并处理这种情况。

用法:
    python3 solve_turnstile.py <url> [--timeout 60] [--proxy http://host:port]

输出 (JSON):
    {"success": true, "token": "...", "cookies": {...}}
    {"success": false, "error": "..."}
"""

import json
import os
import platform
import sys
import time

def is_linux():
    return platform.system().lower() == "linux"

def setup_display():
    if is_linux() and not os.environ.get("DISPLAY"):
        try:
            from pyvirtualdisplay import Display
            display = Display(visible=False, size=(1920, 1080))
            display.start()
            os.environ["DISPLAY"] = display.new_display_var
            return display
        except Exception:
            pass
    return None

def extract_turnstile_token(sb, timeout=30):
    """从页面中提取 Turnstile token"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        # 方法0: 手动 render 回调保存的 token
        try:
            val = sb.execute_script(
                'return window.__turnstile_token || "";'
            )
            if val and len(val) > 20:
                return val
        except Exception:
            pass

        # 方法1: 标准 cf-turnstile-response input
        try:
            val = sb.execute_script(
                'var el = document.querySelector("input[name=cf-turnstile-response], '
                'textarea[name=cf-turnstile-response]"); return el ? el.value : "";'
            )
            if val and len(val) > 20:
                return val
        except Exception:
            pass

        # 方法2: turnstile.getResponse() API
        try:
            val = sb.execute_script(
                'if (typeof turnstile !== "undefined") {'
                '  if (window.__turnstile_widget_id) {'
                '    try { var rr = turnstile.getResponse(window.__turnstile_widget_id); if (rr && rr.length > 20) return rr; } catch(e) {}'
                '  }'
                '  var widgets = document.querySelectorAll("[data-turnstile-widget-id]");'
                '  for (var i = 0; i < widgets.length; i++) {'
                '    var wid = widgets[i].getAttribute("data-turnstile-widget-id");'
                '    try { var r = turnstile.getResponse(wid); if (r && r.length > 20) return r; } catch(e) {}'
                '  }'
                '  try { var r = turnstile.getResponse(); if (r && r.length > 20) return r; } catch(e) {}'
                '} return "";'
            )
            if val and len(val) > 20:
                return val
        except Exception:
            pass

        # 方法3: 扫描所有 hidden input
        try:
            val = sb.execute_script(
                'var inputs = document.querySelectorAll("input[type=hidden], textarea");'
                'for (var i = 0; i < inputs.length; i++) {'
                '  var v = inputs[i].value || "";'
                '  if (v.length > 50 && !v.includes(" ")) return v;'
                '} return "";'
            )
            if val and len(val) > 20:
                return val
        except Exception:
            pass

        time.sleep(0.5)
    return None

def ensure_turnstile_rendered(sb):
    """
    确保 Turnstile widget 已渲染。
    Kombai 注册页用 render=explicit 模式，需要 React 应用调用 turnstile.render()。
    如果 React 应用未渲染，手动触发。
    """
    # 检查 widget 是否已存在（iframe 或 data-sitekey 元素）
    has_widget = sb.execute_script(
        'var frames = document.querySelectorAll("iframe");'
        'for (var i = 0; i < frames.length; i++) {'
        '  if (frames[i].src && frames[i].src.indexOf("challenges.cloudflare") >= 0) return "iframe";'
        '}'
        'var el = document.querySelector("[data-sitekey]");'
        'if (el) return "sitekey-el";'
        'return "";'
    )
    if has_widget:
        return True

    # Widget 未渲染 - 尝试手动触发
    # 从 __NEXT_DATA__ 提取 sitekey
    sitekey = sb.execute_script(
        'try {'
        '  var el = document.getElementById("__NEXT_DATA__");'
        '  if (el) {'
        '    var data = JSON.parse(el.textContent);'
        '    var cfg = data.props && data.props.pageProps && data.props.pageProps.pageConfig;'
        '    if (cfg && cfg.turnstile_site_key) return cfg.turnstile_site_key;'
        '  }'
        '} catch(e) {} return "";'
    )

    if not sitekey:
        return False

    # 创建容器并手动渲染 Turnstile widget
    rendered = sb.execute_script(
        f'if (typeof turnstile !== "undefined") {{'
        f'  var container = document.getElementById("turnstile-auto-container");'
        f'  if (!container) {{'
        f'    container = document.createElement("div");'
        f'    container.id = "turnstile-auto-container";'
        f'    var form = document.querySelector("form");'
        f'    if (form) form.appendChild(container);'
        f'    else document.body.appendChild(container);'
        f'  }}'
        f'  try {{'
        f'    var widgetId = turnstile.render(container, {{'
        f'      sitekey: "{sitekey}",'
        f'      callback: function(token) {{'
        f'        var el = document.querySelector("input[name=cf-turnstile-response]");'
        f'        if (!el) {{'
        f'          el = document.createElement("input");'
        f'          el.type = "hidden";'
        f'          el.name = "cf-turnstile-response";'
        f'          document.body.appendChild(el);'
        f'        }}'
        f'        if (el) el.value = token;'
        f'        window.__turnstile_token = token;'
        f'      }}'
        f'    }});'
        f'    window.__turnstile_widget_id = widgetId;'
        f'    container.setAttribute("data-turnstile-widget-id", widgetId);'
        f'    return true;'
        f'  }} catch(e) {{ return "error:" + e.message; }}'
        f'}}'
        f'return "no-turnstile-api";'
    )

    return rendered is True

def click_turnstile(sb):
    """点击 Turnstile 验证框"""
    # 等待 iframe 出现
    for _ in range(6):
        has_iframe = sb.execute_script(
            'var frames = document.querySelectorAll("iframe");'
            'for (var i = 0; i < frames.length; i++) {'
            '  if (frames[i].src && frames[i].src.indexOf("challenges.cloudflare") >= 0) return true;'
            '} return false;'
        )
        if has_iframe:
            break
        time.sleep(1)

    # 策略 1: SeleniumBase UC 内置方法
    try:
        sb.uc_gui_click_captcha()
        time.sleep(4)
        token = extract_turnstile_token(sb, timeout=5)
        if token:
            return True
    except Exception:
        pass

    # 策略 2: 通过坐标点击 iframe
    try:
        iframe_info = sb.execute_script(
            'var frames = document.querySelectorAll("iframe");'
            'for (var i = 0; i < frames.length; i++) {'
            '  if (frames[i].src && frames[i].src.indexOf("challenges.cloudflare") >= 0) {'
            '    var rect = frames[i].getBoundingClientRect();'
            '    return JSON.stringify({x: rect.x, y: rect.y, w: rect.width, h: rect.height});'
            '  }'
            '} return "";'
        )
        if iframe_info:
            info = json.loads(iframe_info)
            click_x = info["x"] + 30
            click_y = info["y"] + info["h"] / 2
            sb.execute_script(
                f'var el = document.elementFromPoint({click_x}, {click_y});'
                f'if (el) {{'
                f'  el.dispatchEvent(new MouseEvent("mousedown", {{clientX: {click_x}, clientY: {click_y}, bubbles: true}}));'
                f'  el.dispatchEvent(new MouseEvent("mouseup", {{clientX: {click_x}, clientY: {click_y}, bubbles: true}}));'
                f'  el.dispatchEvent(new MouseEvent("click", {{clientX: {click_x}, clientY: {click_y}, bubbles: true}}));'
                f'}}'
            )
            time.sleep(4)
            token = extract_turnstile_token(sb, timeout=5)
            if token:
                return True
    except Exception:
        pass

    # 策略 3: switch_to_frame 方式
    try:
        sb.switch_to_frame("iframe[src*='challenges']")
        for sel in ["input[type='checkbox']", "#challenge-stage", "body"]:
            try:
                sb.click(sel)
                break
            except Exception:
                pass
        sb.switch_to_default_content()
        time.sleep(4)
        token = extract_turnstile_token(sb, timeout=5)
        if token:
            return True
    except Exception:
        pass

    return False

def solve_turnstile(url, proxy=None, timeout=60.0):
    """主求解函数"""
    result = {
        "success": False,
        "token": None,
        "cookies": {},
        "cf_clearance": None,
        "user_agent": None,
        "error": None,
    }

    display = None
    try:
        display = setup_display()
        from seleniumbase import SB

        chrome_bin = os.environ.get("CHROME_BIN") or None
        with SB(
            uc=True,
            test=True,
            locale="en",
            proxy=proxy,
            use_chromium=True,
            binary_location=chrome_bin,
        ) as sb:
            sb.uc_open_with_reconnect(url, reconnect_time=10.0)
            time.sleep(5)

            # 确保 Turnstile widget 已渲染
            ensure_turnstile_rendered(sb)
            time.sleep(3)

            # 多轮尝试点击
            for attempt in range(3):
                if click_turnstile(sb):
                    break
                time.sleep(2)

            # 最终提取
            token = extract_turnstile_token(sb, timeout=10)

            cookies_list = sb.get_cookies()
            cookies = {c["name"]: c["value"] for c in cookies_list}
            user_agent = sb.execute_script("return navigator.userAgent")

            result["cookies"] = cookies
            result["cf_clearance"] = cookies.get("cf_clearance")
            result["user_agent"] = user_agent

            if token:
                result["success"] = True
                result["token"] = token
            else:
                result["error"] = "未能提取 Turnstile token"

    except Exception as e:
        result["error"] = str(e)
    finally:
        if display:
            try:
                display.stop()
            except Exception:
                pass

    return result

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Cloudflare Turnstile 求解器")
    parser.add_argument("url", help="目标 URL")
    parser.add_argument("-t", "--timeout", type=float, default=60.0)
    parser.add_argument("-p", "--proxy", help="代理地址")
    args = parser.parse_args()

    result = solve_turnstile(args.url, proxy=args.proxy, timeout=args.timeout)
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["success"] else 1)

if __name__ == "__main__":
    main()
