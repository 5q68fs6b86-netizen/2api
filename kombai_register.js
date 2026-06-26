#!/usr/bin/env node
/**
 * Kombai 注册机 - 使用 Playwright 浏览器自动化
 * 通过临时邮箱自动注册 Kombai 账号
 */

const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

// ============ 配置 ============
const TEMP_MAIL_API = 'https://e.114514heihei.eu.org';
const TEMP_MAIL_ADMIN_AUTH = 'mapiwbh@pass';
const TEMP_MAIL_DOMAIN = '114514heihei.eu.org';
const KOMBAI_AUTH_URL = 'https://auth.kombai.com';
const KOMBAI_APP_URL = 'https://app.kombai.com';

// ============ 临时邮箱 API ============
async function apiRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = urlObj.protocol === 'https:' ? https : http;
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };
    const req = mod.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

// 创建临时邮箱
async function createTempEmail(name) {
  const resp = await apiRequest(`${TEMP_MAIL_API}/admin/new_address`, {
    method: 'POST',
    headers: { 'x-admin-auth': TEMP_MAIL_ADMIN_AUTH },
    body: { name, domain: TEMP_MAIL_DOMAIN },
  });
  if (resp.status === 200 && resp.data.jwt) {
    return { address: resp.data.address, jwt: resp.data.jwt };
  }
  throw new Error(`创建邮箱失败: ${JSON.stringify(resp.data)}`);
}

// 获取邮件列表
async function getMails(address) {
  const resp = await apiRequest(
    `${TEMP_MAIL_API}/admin/mails?limit=20&offset=0&address=${encodeURIComponent(address)}`,
    { headers: { 'x-admin-auth': TEMP_MAIL_ADMIN_AUTH } }
  );
  if (resp.status === 200) return resp.data.results || [];
  return [];
}

// 获取单封邮件详情
async function getMailDetail(mailId, jwt) {
  const resp = await apiRequest(`${TEMP_MAIL_API}/api/mail/${mailId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  return resp.data;
}

// 从邮件中提取验证码
function extractVerificationCode(mailText) {
  if (!mailText) return null;
  // 常见验证码模式: 6位数字
  const patterns = [
    /verification code[:\s]*(\d{4,8})/i,
    /code[:\s]*(\d{4,8})/i,
    /(\d{6})/,
    /verify.*?(\d{4,8})/i,
    /confirm.*?(\d{4,8})/i,
  ];
  for (const p of patterns) {
    const m = mailText.match(p);
    if (m) return m[1];
  }
  return null;
}

// 从邮件中提取确认链接
function extractVerifyLink(html) {
  if (!html) return null;
  const patterns = [
    /href="(https?:\/\/[^"]*verify[^"]*)"/i,
    /href="(https?:\/\/[^"]*confirm[^"]*)"/i,
    /href="(https?:\/\/[^"]*activate[^"]*)"/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1].replace(/&amp;/g, '&');
  }
  return null;
}

// ============ Kombai 注册 ============
async function registerKombai(email, password) {
  console.log(`\n[注册] 开始注册 Kombai: ${email}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    // 拦截网络请求，捕获关键信息
    const apiResponses = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/fe/v2/')) {
        try {
          const body = await response.text();
          apiResponses.push({ url, status: response.status(), body });
        } catch {}
      }
    });

    // Step 1: 访问 Kombai 注册页面
    console.log('[注册] 访问注册页面...');
    await page.goto(`${KOMBAI_APP_URL}/auth`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Step 2: 导航到注册表单
    console.log('[注册] 导航到注册表单...');

    // 查找并点击 "Sign up" 链接
    const signupLink = page.locator('text=Sign up').first();
    if (await signupLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await signupLink.click();
      await page.waitForTimeout(1000);
    }

    // Step 3: 填写注册表单
    console.log('[注册] 填写注册表单...');

    // 等待邮箱输入框出现
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    await emailInput.waitFor({ timeout: 10000 });
    await emailInput.fill(email);

    // 填写密码
    const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
    await passwordInput.waitFor({ timeout: 5000 });
    await passwordInput.fill(password);

    // Step 4: 提交注册
    console.log('[注册] 提交注册...');
    const submitButton = page.locator('button[type="submit"], button:has-text("Sign up"), button:has-text("Sign Up"), button:has-text("Register")').first();
    await submitButton.click();

    // 等待响应
    await page.waitForTimeout(5000);

    // 检查API响应
    console.log('[注册] API 响应:');
    for (const r of apiResponses) {
      if (r.url.includes('signup') || r.url.includes('verify') || r.url.includes('login_state')) {
        console.log(`  ${r.url.split('/').pop()}: ${r.status} ${r.body.substring(0, 200)}`);
      }
    }

    // 检查页面是否有错误
    const errorText = await page.locator('.error, .alert-error, [class*="error"], [class*="Error"]').textContent().catch(() => '');
    if (errorText) {
      console.log(`[注册] 页面错误: ${errorText}`);
    }

    // 检查当前页面URL和状态
    console.log(`[注册] 当前URL: ${page.url()}`);
    const pageContent = await page.textContent('body');

    // 检查是否需要邮箱确认
    if (pageContent.includes('Confirm') || pageContent.includes('confirm') || pageContent.includes('verify') || pageContent.includes('email')) {
      console.log('[注册] 需要邮箱确认');
      return { success: true, needVerification: true, pageContent };
    }

    // 检查是否注册成功
    if (page.url().includes('account') || page.url().includes('dashboard') || page.url().includes('org')) {
      console.log('[注册] 注册成功！');
      return { success: true, needVerification: false };
    }

    return { success: false, pageContent: pageContent.substring(0, 500), apiResponses };

  } catch (e) {
    console.error(`[注册] 错误: ${e.message}`);
    return { success: false, error: e.message };
  } finally {
    await browser.close();
  }
}

// 通过链接完成邮箱验证
async function verifyViaLink(verifyUrl) {
  console.log(`\n[验证] 通过链接验证: ${verifyUrl}`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(verifyUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    console.log(`[验证] 验证后URL: ${page.url()}`);
    const content = await page.textContent('body');
    console.log(`[验证] 页面内容: ${content.substring(0, 300)}`);
    return { success: true };
  } catch (e) {
    console.error(`[验证] 错误: ${e.message}`);
    return { success: false, error: e.message };
  } finally {
    await browser.close();
  }
}

// ============ 主流程 ============
async function main() {
  const timestamp = Date.now();
  const randStr = Math.random().toString(36).substring(2, 8);
  const emailName = `kombai${timestamp}${randStr}`;
  const email = `${emailName}@${TEMP_MAIL_DOMAIN}`;
  const password = `K0mb@i_${randStr}A1!`;

  console.log('='.repeat(60));
  console.log('Kombai 自动注册机');
  console.log('='.repeat(60));
  console.log(`邮箱: ${email}`);
  console.log(`密码: ${password}`);

  // Step 1: 创建临时邮箱
  console.log('\n[邮箱] 创建临时邮箱...');
  let tempEmail;
  try {
    tempEmail = await createTempEmail(emailName);
    console.log(`[邮箱] 创建成功: ${tempEmail.address}`);
  } catch (e) {
    console.error(`[邮箱] 创建失败: ${e.message}`);
    process.exit(1);
  }

  // Step 2: 注册 Kombai
  const result = await registerKombai(email, password);

  if (result.success && result.needVerification) {
    // Step 3: 等待验证邮件
    console.log('\n[邮箱] 等待验证邮件...');
    let verified = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const mails = await getMails(tempEmail.address);
      console.log(`[邮箱] 第${i + 1}次检查, 邮件数: ${mails.length}`);

      if (mails.length > 0) {
        for (const mail of mails) {
          console.log(`[邮箱] 收到邮件: ${mail.subject || '无主题'} from ${mail.from || '未知'}`);

          // 获取邮件详情
          const detail = await getMailDetail(mail.id, tempEmail.jwt);
          const text = detail.text || detail.subject || '';
          const html = detail.html || '';

          // 尝试提取验证链接
          const verifyLink = extractVerifyLink(html);
          if (verifyLink) {
            console.log(`[邮箱] 找到验证链接: ${verifyLink}`);
            const vResult = await verifyViaLink(verifyLink);
            if (vResult.success) {
              verified = true;
              break;
            }
          }

          // 尝试提取验证码
          const code = extractVerificationCode(text);
          if (code) {
            console.log(`[邮箱] 找到验证码: ${code}`);
            // TODO: 提交验证码到 Kombai
          }
        }
        if (verified) break;
      }
    }

    if (verified) {
      console.log('\n✅ 邮箱验证完成！');
    } else {
      console.log('\n⚠️ 未能自动完成邮箱验证');
    }
  } else if (result.success) {
    console.log('\n✅ 注册成功（无需邮箱验证）！');
  } else {
    console.log('\n❌ 注册失败');
    if (result.apiResponses) {
      console.log('API 响应:');
      for (const r of result.apiResponses) {
        console.log(`  ${r.url}: ${r.status} ${r.body.substring(0, 300)}`);
      }
    }
    if (result.pageContent) {
      console.log('页面内容:', result.pageContent);
    }
  }

  // 输出结果
  console.log('\n' + '='.repeat(60));
  console.log('注册结果:');
  console.log(JSON.stringify({
    email,
    password,
    address: tempEmail.address,
    success: result.success,
    needVerification: result.needVerification || false,
  }, null, 2));
}

main().catch(console.error);
