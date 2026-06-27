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
 * 策略：用浏览器访问 connect URL，同时监听网络请求，
 * 找到授权 API 端点后直接用 HTTP API 完成授权
 */
async function completeVscodeConnect(connectUrl, cookies = {}, credentials = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: DEFAULT_USER_AGENT });
  const page = await context.newPage();

  // 收集所有网络请求以发现授权 API
  const apiRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/') || url.includes('/auth') || url.includes('/connect')) {
      apiRequests.push({
        method: request.method(),
        url,
        headers: request.headers(),
        postData: request.postData(),
      });
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/') || url.includes('/auth') || url.includes('/connect')) {
      try {
        const body = await response.text();
        console.log(`[auto-register] API response: ${response.status()} ${url} => ${body.substring(0, 200)}`);
      } catch {}
    }
  });

  try {
    // 设置 cookies 到所有相关域名
    for (const [domain, domainCookies] of Object.entries(groupCookiesByDomain(cookies, connectUrl))) {
      const cookieList = Object.entries(domainCookies).map(([name, value]) => ({
        name,
        value: String(value),
        domain,
        path: '/',
      }));
      if (cookieList.length > 0) {
        await context.addCookies(cookieList);
      }
    }

    // 同时也为 auth.kombai.com 设置 cookies
    if (credentials.cookies) {
      for (const [domain, domainCookies] of Object.entries(groupCookiesByDomain(credentials.cookies, 'https://auth.kombai.com'))) {
        const cookieList = Object.entries(domainCookies).map(([name, value]) => ({
          name,
          value: String(value),
          domain,
          path: '/',
        }));
        if (cookieList.length > 0) {
          await context.addCookies(cookieList);
        }
      }
    }

    await page.goto(connectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    let url = page.url();
    console.log('[auto-register] browser_connect initial url:', url);

    // 如果被重定向到登录页面，尝试通过 API 登录
    if (url.includes('login') || url.includes('signup')) {
      // 先尝试用 HTTP API 登录获取 session cookies
      const loginResult = await httpLogin(credentials.email, credentials.password, credentials.authUrl);
      if (loginResult.cookies) {
        for (const [domain, domainCookies] of Object.entries(groupCookiesByDomain(loginResult.cookies, url))) {
          const cookieList = Object.entries(domainCookies).map(([name, value]) => ({
            name,
            value: String(value),
            domain,
            path: '/',
          }));
          if (cookieList.length > 0) {
            await context.addCookies(cookieList);
          }
        }
      }

      // 重新访问 connect URL
      await page.goto(connectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
      url = page.url();
      console.log('[auto-register] browser_connect after API login, url:', url);

      // 如果还是在登录页面，尝试浏览器表单登录
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

    console.log('[auto-register] browser_connect final url:', url);
    console.log('[auto-register] browser_connect API requests:', JSON.stringify(apiRequests.map(r => ({ method: r.method, url: r.url })), null, 2));

    return {
      success: !url.includes('signup') && !url.includes('login') && !url.includes('error'),
      url,
      pageText: (text || '').substring(0, 500),
      apiRequests: apiRequests.map(r => ({ method: r.method, url: r.url })),
    };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    await browser.close();
  }
}

/**
 * 通过 HTTP API 登录并返回 cookies
 */
async function httpLogin(email, password, authUrl) {
  const { request, CookieJar } = require('./httpClient');
  const jar = new CookieJar();
  const normalizedUrl = normalizeAuthUrl(authUrl);

  try {
    const resp = await request(`${normalizedUrl}/api/fe/v1/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': DEFAULT_USER_AGENT,
      },
      body: { email, password },
    });
    jar.addFromHeaders(resp.headers['set-cookie']);

    return {
      success: resp.status === 200,
      cookies: jar.toJSON(),
      status: resp.status,
      data: resp.data,
    };
  } catch (error) {
    return { success: false, error: error.message, cookies: {} };
  }
}

/**
 * 浏览器表单登录
 */
async function browserFormLogin(page, credentials) {
  try {
    // 尝试多种方式找到并填写登录表单
    const emailSelectors = [
      'input[type="email"]:visible',
      'input[name="email"]:visible',
      'input[placeholder*="email" i]:visible',
      'input[autocomplete="email"]:visible',
      'input[id*="email" i]:visible',
    ];
    const passwordSelectors = [
      'input[type="password"]:visible',
      'input[name="password"]:visible',
      'input[autocomplete="current-password"]:visible',
    ];

    let emailInput = null;
    let passwordInput = null;

    for (const sel of emailSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        emailInput = el;
        break;
      }
    }

    for (const sel of passwordSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        passwordInput = el;
        break;
      }
    }

    if (emailInput && passwordInput && credentials.email && credentials.password) {
      await emailInput.fill(credentials.email);
      await passwordInput.fill(credentials.password);

      const loginBtnSelectors = [
        'button:has-text("Log in")',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
        'button[type="submit"]',
      ];

      for (const sel of loginBtnSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
          await btn.click();
          break;
        }
      }

      await page.waitForTimeout(5000);
    }
  } catch (error) {
    console.error('[auto-register] browserFormLogin error:', error.message);
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
  onProgress({ step: 'browser_connect', status: 'running' });
  let connectResult = null;
  try {
    connectResult = await completeVscodeConnect(connectAuth.url, cookies, { email, password });
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
