#!/usr/bin/env node
/**
 * Kombai 注册机 v2 - 完整注册+验证+token提取
 */

const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const TEMP_MAIL_API = 'https://e.114514heihei.eu.org';
const TEMP_MAIL_ADMIN_AUTH = 'mapiwbh@pass';
const TEMP_MAIL_DOMAIN = '114514heihei.eu.org';
const KOMBAI_AUTH_URL = 'https://auth.kombai.com';

// ============ 临时邮箱 API ============
async function apiRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = urlObj.protocol === 'https:' ? https : http;
    const reqOptions = {
      hostname: urlObj.hostname, port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    };
    const req = mod.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

async function createTempEmail(name) {
  const resp = await apiRequest(TEMP_MAIL_API + '/admin/new_address', {
    method: 'POST',
    headers: { 'x-admin-auth': TEMP_MAIL_ADMIN_AUTH },
    body: { name, domain: TEMP_MAIL_DOMAIN },
  });
  if (resp.status === 200 && resp.data.jwt) return resp.data;
  throw new Error('创建邮箱失败: ' + JSON.stringify(resp.data));
}

async function getMails(address) {
  const resp = await apiRequest(
    TEMP_MAIL_API + '/admin/mails?limit=20&offset=0&address=' + encodeURIComponent(address),
    { headers: { 'x-admin-auth': TEMP_MAIL_ADMIN_AUTH } }
  );
  return resp.status === 200 ? (resp.data.results || []) : [];
}

async function getMailDetail(mailId, jwt) {
  const resp = await apiRequest(TEMP_MAIL_API + '/api/mail/' + mailId, {
    headers: { Authorization: 'Bearer ' + jwt },
  });
  return resp.data;
}

// ============ Kombai 注册 ============
async function registerKombai(email, password) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 访问 signup 页面
    await page.goto(KOMBAI_AUTH_URL + '/signup', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    // 填写表单
    const emailInput = page.locator('input[type="email"]:visible').first();
    const passwordInput = page.locator('input[type="password"]:visible').first();
    await emailInput.fill(email);
    await passwordInput.fill(password);

    // 点击 Sign Up
    const signupBtn = page.locator('button:has-text("Sign Up"):visible').first();
    await signupBtn.click();
    await page.waitForTimeout(5000);

    const pageText = await page.textContent('body');
    const url = page.url();

    // 检查是否需要邮箱确认
    if (url.includes('confirm_email') || pageText.includes('Confirm')) {
      return { success: true, needVerification: true, userId: null };
    }

    return { success: true, needVerification: false };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    await browser.close();
  }
}

// ============ 邮箱验证 ============
async function waitForVerificationEmail(address, jwt, maxWait = 60) {
  for (let i = 0; i < maxWait / 3; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const mails = await getMails(address);
    if (mails.length > 0) {
      const detail = await getMailDetail(mails[0].id, jwt);
      const html = detail.html || '';
      // 提取验证链接
      const linkMatch = html.match(/href="(https?:\/\/[^"]*confirm_email[^"]*)"/i) ||
                         html.match(/href="(https?:\/\/[^"]*verify[^"]*)"/i);
      if (linkMatch) {
        return linkMatch[1].replace(/&amp;/g, '&').replace(/=\r?\n/g, '').replace(/3D/g, '');
      }
    }
  }
  return null;
}

async function confirmEmail(verifyUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 监听获取token的请求
    let accessToken = null;
    page.on('response', async (resp) => {
      if (resp.url().includes('/api/fe/v2/')) {
        try {
          const body = await resp.text();
          if (body.includes('access_token') || body.includes('accessToken')) {
            const parsed = JSON.parse(body);
            accessToken = parsed.access_token || parsed.accessToken;
          }
        } catch {}
      }
    });

    await page.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(5000);

    const url = page.url();
    const text = await page.textContent('body');

    // 从cookies中提取token
    const cookies = await page.context().cookies();
    const authCookie = cookies.find(c => c.name.includes('auth') || c.name.includes('token') || c.name.includes('session'));

    return {
      success: url.includes('account') || url.includes('dashboard') || !url.includes('confirm'),
      url,
      accessToken,
      cookies: cookies.map(c => ({ name: c.name, value: c.value.substring(0, 50) })),
      pageText: text.substring(0, 300),
    };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    await browser.close();
  }
}

// ============ 主流程 ============
async function main() {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  const emailName = 'kombai' + ts + rand;
  const email = emailName + '@' + TEMP_MAIL_DOMAIN;
  const password = 'K0mb@i_' + rand + 'A1!';

  console.log('='.repeat(60));
  console.log('Kombai 自动注册机 v2');
  console.log('='.repeat(60));
  console.log('邮箱:', email);
  console.log('密码:', password);

  // Step 1: 创建临时邮箱
  console.log('\n[1] 创建临时邮箱...');
  const tempEmail = await createTempEmail(emailName);
  console.log('邮箱创建成功:', tempEmail.address);

  // Step 2: 注册 Kombai
  console.log('\n[2] 注册 Kombai...');
  const regResult = await registerKombai(email, password);
  console.log('注册结果:', JSON.stringify(regResult));

  if (!regResult.success) {
    console.error('❌ 注册失败');
    process.exit(1);
  }

  // Step 3: 等待验证邮件
  if (regResult.needVerification) {
    console.log('\n[3] 等待验证邮件...');
    const verifyUrl = await waitForVerificationEmail(tempEmail.address, tempEmail.jwt);
    if (!verifyUrl) {
      console.error('❌ 未收到验证邮件');
      process.exit(1);
    }
    console.log('验证链接:', verifyUrl);

    // Step 4: 完成邮箱验证
    console.log('\n[4] 完成邮箱验证...');
    const confirmResult = await confirmEmail(verifyUrl);
    console.log('验证结果:', JSON.stringify(confirmResult, null, 2));

    if (confirmResult.success) {
      console.log('\n✅ 注册并验证成功！');
    } else {
      console.log('\n⚠️ 注册成功，验证可能需要手动完成');
    }
  }

  // 输出结果
  console.log('\n' + '='.repeat(60));
  console.log('注册信息:');
  console.log(JSON.stringify({
    email,
    password,
    tempEmailAddress: tempEmail.address,
    tempEmailJwt: tempEmail.jwt,
  }, null, 2));
}

main().catch(console.error);
