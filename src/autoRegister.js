'use strict';

const { chromium } = require('playwright');
const { CookieJar } = require('./httpClient');
const {
  DEFAULT_TEMP_MAIL_DOMAIN,
  createTempEmail,
  waitForVerificationEmail,
} = require('./tempMail');
const {
  getSignupConfig,
  signup,
  login,
  makeEmailName,
  makePassword,
  normalizeAuthUrl,
  DEFAULT_KOMBAI_AUTH_URL,
} = require('./kombaiAuth');
const {
  buildAuthConnectUrl,
  pollAuthCode,
  verifyApiKey,
} = require('./kombaiClient');

const DEFAULT_USER_AGENT =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function extractApiKeyToken(data) {
  if (!data || typeof data !== 'object') return '';
  return (
    data.apiKeyToken ||
    data.apiKey ||
    data.token ||
    (data.data && extractApiKeyToken(data.data)) ||
    ''
  );
}

/**
 * 用 Playwright 浏览器访问验证链接
 * 如果验证后重定向到已登录页面，返回成功
 */
async function visitVerificationLink(verifyUrl, cookies = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: DEFAULT_USER_AGENT });
  const page = await context.newPage();

  try {
    // 设置 cookies
    const cookieList = Object.entries(cookies).map(([name, value]) => ({
      name,
      value: String(value),
      domain: new URL(verifyUrl).hostname,
      path: '/',
    }));
    if (cookieList.length > 0) {
      await context.addCookies(cookieList);
    }

    await page.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const url = page.url();
    const text = await page.textContent('body').catch(() => '');

    // 获取更新后的 cookies
    const updatedCookies = await context.cookies();
    const cookieMap = {};
    for (const c of updatedCookies) {
      cookieMap[c.name] = c.value;
    }

    return {
      success:
        url.includes('account') ||
        url.includes('dashboard') ||
        url.includes('confirm') ||
        !url.includes('error'),
      url,
      cookies: cookieMap,
      pageText: (text || '').substring(0, 500),
    };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    await browser.close();
  }
}

/**
 * 用 Playwright 浏览器完成 vscode-connect 授权
 * 策略：通过 API 在正确域名登录，获取 cookies 后访问 connect URL
 */
async function completeVscodeConnect(connectUrl, cookies = {}, credentials = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: DEFAULT_USER_AGENT });
  const page = await context.newPage();

  // 收集关键 API 响应（忽略静态资源）
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/') && !url.includes('sentry') && !url.includes('facebook') && !url.includes('aplo-evnt') && !url.includes('_next/static')) {
      try {
        const body = await response.text();
        console.log(`[auto-register] API: ${response.status()} ${url} => ${body.substring(0, 300)}`);
      } catch {}
    }
  });

  try {
    // 先访问 connect URL，看看被重定向到哪里
    await page.goto(connectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    let url = page.url();
    console.log('[auto-register] browser_connect initial url:', url);

    // 如果被重定向到登录页面，在该域名下通过 API 登录
    if (url.includes('login') || url.includes('signup')) {
      // 从当前页面 URL 提取 auth 基础 URL
      const currentUrl = new URL(url);
      const authBaseUrl = `${currentUrl.protocol}//${currentUrl.hostname}`;

      // 尝试通过 API 登录
      const apiLoginResult = await apiLoginOnDomain(authBaseUrl, credentials.email, credentials.password);
      console.log('[auto-register] API login result:', JSON.stringify({
        success: apiLoginResult.success,
        status: apiLoginResult.status,
      }));

      if (apiLoginResult.success && apiLoginResult.cookies) {
        // 设置登录后的 cookies
        for (const [name, value] of Object.entries(apiLoginResult.cookies)) {
          await context.addCookies([{
            name,
            value: String(value),
            domain: currentUrl.hostname,
            path: '/',
          }]);
        }

        // 重新访问 connect URL
        await page.goto(connectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);
        url = page.url();
        console.log('[auto-register] browser_connect after API login, url:', url);
      }

      // 如果 API 登录不成功或仍然在登录页，尝试浏览器表单登录
      if (url.includes('login') || url.includes('signup')) {
        await browserFormLogin(page, credentials);
        await page.waitForTimeout(5000);
        url = page.url();
        console.log('[auto-register] browser_connect after form login, url:', url);
      }
    }

    // 等待可能的重定向和 API 调用完成
    await page.waitForTimeout(5000);
    url = page.url();
    const text = await page.textContent('body').catch(() => '');

    return {
      success: !url.includes('signup') && !url.includes('login') && !url.includes('error'),
      url,
      pageText: (text || '').substring(0, 500),
    };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    await browser.close();
  }
}

/**
 * 在指定域名通过 API 登录
 */
async function apiLoginOnDomain(baseUrl, email, password) {
  const { request, CookieJar } = require('./httpClient');
  const jar = new CookieJar();

  // 尝试多种登录 API 端点
  const endpoints = [
    '/api/fe/v1/login',
  ];

  for (const endpoint of endpoints) {
    try {
      const resp = await request(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': '-.-',
          'User-Agent': DEFAULT_USER_AGENT,
          'Origin': baseUrl,
          'Referer': `${baseUrl}/en/login`,
        },
        body: { email, password },
      });
      jar.addFromHeaders(resp.headers['set-cookie']);

      console.log(`[auto-register] API login ${endpoint}: status=${resp.status}`);

      if (resp.status === 200 && resp.data && (resp.data.user_id || resp.data.userId)) {
        return {
          success: true,
          cookies: jar.toJSON(),
          status: resp.status,
          endpoint,
        };
      }
    } catch (error) {
      console.log(`[auto-register] API login ${endpoint} error: ${error.message}`);
    }
  }

  return { success: false, cookies: jar.toJSON() };
}

/**
 * 浏览器表单登录 - 填写表单并等待提交
 */
async function browserFormLogin(page, credentials) {
  try {
    // 等待页面稳定
    await page.waitForTimeout(2000);

    // 找 email 输入框（login 页面用 type="text", signup 用 type="email"）
    const emailSelectors = [
      'input[autocomplete="email"]:visible',
      'input[type="email"]:visible',
      'input[type="text"][placeholder*="email" i]:visible',
    ];
    const passwordSelectors = [
      'input[type="password"]:visible',
      'input[autocomplete="current-password"]:visible',
    ];

    let emailInput = null;
    let passwordInput = null;

    for (const sel of emailSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        emailInput = el;
        console.log('[auto-register] browserFormLogin found email:', sel);
        break;
      }
    }

    for (const sel of passwordSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        passwordInput = el;
        console.log('[auto-register] browserFormLogin found password:', sel);
        break;
      }
    }

    if (!emailInput || !passwordInput) {
      console.log('[auto-register] browserFormLogin: form inputs not found');
      return false;
    }

    // 用 type() 模拟用户逐字输入，触发前端验证
    await emailInput.click();
    await page.keyboard.type(credentials.email, { delay: 30 });
    await page.waitForTimeout(500);

    await passwordInput.click();
    await page.keyboard.type(credentials.password, { delay: 30 });
    await page.waitForTimeout(1000);

    // 等待按钮变为可用状态（最多 10 秒）
    const loginBtnSelectors = [
      'button:has-text("Log in with email")',
      'button:has-text("Log In")',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
    ];

    let loginBtn = null;
    for (const sel of loginBtnSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        loginBtn = el;
        console.log('[auto-register] browserFormLogin found button:', sel);
        break;
      }
    }

    if (!loginBtn) {
      console.log('[auto-register] browserFormLogin: login button not found');
      return false;
    }

    // 等待按钮可用（最多 10 秒）
    for (let i = 0; i < 20; i++) {
      const disabled = await loginBtn.isDisabled().catch(() => true);
      if (!disabled) break;
      await page.waitForTimeout(500);
    }

    // 点击登录
    await loginBtn.click({ timeout: 5000 });
    console.log('[auto-register] browserFormLogin clicked login button');

    // 等待导航完成
    await page.waitForTimeout(8000);

    return true;
  } catch (error) {
    console.error('[auto-register] browserFormLogin error:', error.message);
    return false;
  }
}

function groupCookiesByDomain(cookies, url) {
  const hostname = new URL(url).hostname;
  const result = {};
  for (const [name, value] of Object.entries(cookies)) {
    // 为主域名和所有父域添加 cookie
    const parts = hostname.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const domain = parts.slice(i).join('.');
      if (!result[domain]) result[domain] = {};
      result[domain][name] = value;
    }
  }
  return result;
}

/**
 * 自动注册一个 Kombai 账号并获取 API key
 *
 * 完整管道：
 * 1. 创建临时邮箱
 * 2. 注册 Kombai 账号
 * 3. 等待验证邮件并提取验证链接
 * 4. 用浏览器访问验证链接完成邮箱确认
 * 5. 生成 vscode-connect 授权链接
 * 6. 用浏览器访问授权链接完成授权
 * 7. 轮询获取 apiKeyToken
 * 8. 验证 API key
 */
async function autoRegisterAccount(options = {}) {
  const authUrl = normalizeAuthUrl(options.authUrl);
  const emailPrefix = options.emailPrefix || 'kombai';
  const tempMailOptions = options.tempMail || {};
  const onProgress = options.onProgress || (() => {});

  // Step 1: 创建临时邮箱
  onProgress({ step: 'create_email', status: 'running' });
  const emailName = makeEmailName(emailPrefix);
  const password = makePassword(emailName.slice(-8));
  let tempEmail;
  try {
    tempEmail = await createTempEmail(emailName, tempMailOptions);
    onProgress({ step: 'create_email', status: 'done', email: tempEmail.address });
  } catch (error) {
    onProgress({ step: 'create_email', status: 'error', error: error.message });
    throw new Error(`创建临时邮箱失败: ${error.message}`);
  }

  const email = tempEmail.address;

  // Step 2: 获取注册配置
  onProgress({ step: 'signup_config', status: 'running' });
  const jar = new CookieJar();
  let pageConfig = null;
  try {
    const config = await getSignupConfig({ jar, authUrl });
    pageConfig = config.pageConfig;
    onProgress({ step: 'signup_config', status: 'done' });
  } catch (error) {
    onProgress({ step: 'signup_config', status: 'error', error: error.message });
    throw new Error(`获取注册配置失败: ${error.message}`);
  }

  // Step 3: 注册
  onProgress({ step: 'signup', status: 'running' });
  let signupResult;
  try {
    signupResult = await signup(email, password, {
      jar,
      authUrl,
      pageConfig,
      turnstileToken: options.turnstileToken,
      inviteToken: options.inviteToken,
    });
    onProgress({ step: 'signup', status: 'done', userId: signupResult.userId });
  } catch (error) {
    onProgress({ step: 'signup', status: 'error', error: error.message });
    throw new Error(`注册失败: ${error.message}`);
  }

  if (!signupResult.success) {
    const errMsg =
      signupResult.error && signupResult.error.message
        ? signupResult.error.message
        : JSON.stringify(signupResult.error || {});
    onProgress({ step: 'signup', status: 'error', error: errMsg });
    throw new Error(`注册失败: ${errMsg}`);
  }

  // Step 4: 等待验证邮件
  onProgress({ step: 'wait_email', status: 'running' });
  let verification = null;
  try {
    verification = await waitForVerificationEmail(
      tempEmail.address,
      tempEmail.jwt,
      tempMailOptions,
    );
    if (verification) {
      onProgress({ step: 'wait_email', status: 'done', link: verification.link });
    } else {
      onProgress({ step: 'wait_email', status: 'skipped', reason: '未收到验证邮件' });
    }
  } catch (error) {
    onProgress({ step: 'wait_email', status: 'error', error: error.message });
  }

  // Step 5: 访问验证链接
  let cookies = jar.toJSON();
  if (verification && verification.link) {
    onProgress({ step: 'confirm_email', status: 'running' });
    try {
      const confirmResult = await visitVerificationLink(verification.link, cookies);
      if (confirmResult.cookies) {
        cookies = { ...cookies, ...confirmResult.cookies };
      }
      onProgress({
        step: 'confirm_email',
        status: confirmResult.success ? 'done' : 'partial',
        url: confirmResult.url,
      });
    } catch (error) {
      onProgress({ step: 'confirm_email', status: 'error', error: error.message });
    }
  }

  // Step 6: 登录（确保有有效 session）
  onProgress({ step: 'login', status: 'running' });
  let loginResult;
  try {
    loginResult = await login(email, password, { jar, authUrl });
    if (loginResult.jar) {
      cookies = { ...cookies, ...loginResult.jar.toJSON() };
    }
    onProgress({ step: 'login', status: loginResult.success ? 'done' : 'error' });
  } catch (error) {
    onProgress({ step: 'login', status: 'error', error: error.message });
    loginResult = { success: false, error: { message: error.message } };
  }

  // Step 7: 生成 vscode-connect 授权链接
  onProgress({ step: 'connect_url', status: 'running' });
  const connectAuth = buildAuthConnectUrl({ type: 'new' });
  onProgress({
    step: 'connect_url',
    status: 'done',
    code: connectAuth.code,
    url: connectAuth.url,
  });

  // Step 8: 浏览器访问 vscode-connect URL 完成授权
  // 注意：connect URL 会被重定向到 auth.agent.kombai.com（可能不同于 auth.kombai.com）
  // 所以需要在浏览器中自动完成登录
  onProgress({ step: 'browser_connect', status: 'running' });
  let connectResult = null;
  try {
    connectResult = await completeVscodeConnect(connectAuth.url, cookies, {
      email,
      password,
      authUrl,
    });
    onProgress({
      step: 'browser_connect',
      status: connectResult.success ? 'done' : 'partial',
      url: connectResult.url,
      pageText: connectResult.pageText,
    });
  } catch (error) {
    onProgress({ step: 'browser_connect', status: 'error', error: error.message });
  }

  // Step 9: 轮询获取 apiKeyToken
  onProgress({ step: 'poll_auth', status: 'running' });
  let apiKey = '';
  try {
    const pollResult = await pollAuthCode(connectAuth.code, {
      timeoutMs: options.pollTimeoutMs || 120000,
      intervalMs: 3000,
    });
    apiKey = extractApiKeyToken(pollResult);
    if (apiKey) {
      onProgress({ step: 'poll_auth', status: 'done' });
    } else {
      onProgress({ step: 'poll_auth', status: 'error', error: '响应中无 apiKeyToken' });
    }
  } catch (error) {
    onProgress({ step: 'poll_auth', status: 'error', error: error.message });
  }

  if (!apiKey) {
    throw new Error('未能获取 API key，授权流程可能未完成');
  }

  // Step 10: 验证 API key
  onProgress({ step: 'verify', status: 'running' });
  try {
    await verifyApiKey(apiKey);
    onProgress({ step: 'verify', status: 'done' });
  } catch (error) {
    onProgress({ step: 'verify', status: 'warning', error: error.message });
    // 验证失败不阻止保存，key 可能仍然可用
  }

  onProgress({ step: 'complete', status: 'done', apiKey });

  return {
    success: true,
    email,
    password,
    apiKey,
    userId: signupResult.userId || null,
    tempEmailAddress: tempEmail.address,
    verificationLink: verification ? verification.link : null,
    connectCode: connectAuth.code,
    connectUrl: connectAuth.url,
  };
}

module.exports = {
  autoRegisterAccount,
  completeVscodeConnect,
  extractApiKeyToken,
  visitVerificationLink,
};
