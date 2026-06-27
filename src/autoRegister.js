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
const { solveTurnstile } = require('./turnstileSolver');

const DEFAULT_USER_AGENT =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const DEFAULT_CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
];

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function browserLaunchOptions() {
  const extraArgs = String(process.env.PLAYWRIGHT_CHROMIUM_ARGS || '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    args: [...DEFAULT_CHROMIUM_ARGS, ...extraArgs],
  };
}

async function launchChromium() {
  return chromium.launch(browserLaunchOptions());
}

async function addCookiesForUrl(context, targetUrl, cookies = {}) {
  const entries = Object.entries(cookies).filter(([, value]) => value);
  if (entries.length === 0) return 0;

  const parsed = new URL(targetUrl);
  const origin = `${parsed.protocol}//${parsed.hostname}`;
  let added = 0;
  for (const [name, value] of entries) {
    try {
      await context.addCookies([{
        name,
        value: String(value),
        url: origin,
      }]);
      added += 1;
    } catch (error) {
      console.log(`[auto-register] skip cookie ${name}: ${error.message}`);
    }
  }
  return added;
}

async function checkBrowserRuntime() {
  const startedAt = Date.now();
  const browser = await launchChromium();
  try {
    const context = await browser.newContext({ userAgent: DEFAULT_USER_AGENT });
    const page = await context.newPage();
    await page.setContent('<!doctype html><title>ok</title>');
    const title = await page.title();
    await context.close();

    return {
      ok: title === 'ok',
      elapsedMs: Date.now() - startedAt,
      launchOptions: browserLaunchOptions(),
    };
  } finally {
    await browser.close();
  }
}

async function isLoginFormVisible(page) {
  const selectors = [
    'button:has-text("Log in with email")',
    'button:has-text("Log In")',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
  ];
  for (const sel of selectors) {
    if (await page.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function switchToLoginPage(page) {
  let url = page.url();
  if (!url.includes('signup')) return url;

  const allButtons = await page.locator('button:visible, a:visible').all();
  for (const btn of allButtons) {
    const text = await btn.textContent().catch(() => '');
    if (text.trim()) console.log('[auto-register] visible element:', text.trim().substring(0, 80));
  }

  const switchSelectors = [
    'a:has-text("Log in")',
    'button:has-text("Log in")',
    'text=Log in',
    'text=Already have an account?',
  ];
  for (const sel of switchSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('[auto-register] clicking switch:', sel);
        await el.click();
        await page.waitForTimeout(3000);
        url = page.url();
        console.log('[auto-register] after switch url:', url);
        if (url.includes('login') || await isLoginFormVisible(page)) return url;
      }
    } catch {}
  }

  const loginUrl = url.replace('/signup', '/login');
  console.log('[auto-register] navigating to login:', loginUrl);
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);
  return page.url();
}

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
  const browser = await launchChromium();
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
  const browser = await launchChromium();
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
    const injectedCookies = await addCookiesForUrl(context, url, cookies);
    if (injectedCookies > 0) {
      console.log(`[auto-register] injected ${injectedCookies} cookies for ${new URL(url).hostname}`);
      await page.goto(connectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      url = page.url();
      console.log('[auto-register] browser_connect after cookie injection, url:', url);
    }

    // 如果被重定向到登录/注册页面
    if (url.includes('login') || url.includes('signup')) {
      // 先检查是否在 signup 页面，需要切换到 login
      if (url.includes('signup')) {
        url = await switchToLoginPage(page);
      }

      if (url.includes('login') || await isLoginFormVisible(page)) {
        await browserFormLogin(page, credentials);
        await page.waitForTimeout(5000);
        url = page.url();
        console.log('[auto-register] browser_connect after form login, url:', url);
      }

      if (url.includes('login') || url.includes('signup')) {
        const currentUrl = new URL(url);
        const authBaseUrl = `${currentUrl.protocol}//${currentUrl.hostname}`;
        let apiLoginResult = await apiLoginOnDomain(authBaseUrl, credentials.email, credentials.password);
        if (!apiLoginResult.success && credentials.authUrl && normalizeAuthUrl(credentials.authUrl) !== authBaseUrl) {
          apiLoginResult = await apiLoginOnDomain(normalizeAuthUrl(credentials.authUrl), credentials.email, credentials.password);
        }
        console.log('[auto-register] API login result:', JSON.stringify({ success: apiLoginResult.success, status: apiLoginResult.status }));

        if (apiLoginResult.success && apiLoginResult.cookies) {
          await addCookiesForUrl(context, url, apiLoginResult.cookies);
          await page.goto(connectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(5000);
          url = page.url();
          console.log('[auto-register] browser_connect after API login, url:', url);
        }
      }

      if (url.includes('login') || url.includes('signup')) {
        if (url.includes('signup')) url = await switchToLoginPage(page);
        if (url.includes('login') || await isLoginFormVisible(page)) {
          await browserFormLogin(page, credentials);
          await page.waitForTimeout(5000);
        }
        url = page.url();
        console.log('[auto-register] browser_connect after final form login, url:', url);
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
 * 1. 获取注册配置
 * 2. 创建临时邮箱
 * 3. 注册 Kombai 账号
 * 4. 等待验证邮件并提取验证链接
 * 5. 用浏览器访问验证链接完成邮箱确认
 * 6. 生成 vscode-connect 授权链接
 * 7. 用浏览器访问授权链接完成授权
 * 8. 轮询获取 apiKeyToken
 * 9. 验证 API key
 */
async function autoRegisterAccount(options = {}) {
  const authUrl = normalizeAuthUrl(firstNonEmpty(options.authUrl, process.env.KOMBAI_AUTH_URL, DEFAULT_KOMBAI_AUTH_URL));
  const emailPrefix = firstNonEmpty(options.emailPrefix, process.env.AUTO_EMAIL_PREFIX, 'kombai');
  const turnstileToken = firstNonEmpty(options.turnstileToken, process.env.TURNSTILE_TOKEN);
  const inviteToken = firstNonEmpty(options.inviteToken, process.env.KOMBAI_INVITE_TOKEN, process.env.INVITE_TOKEN);
  const pollTimeoutMs = Number(firstNonEmpty(options.pollTimeoutMs, process.env.KOMBAI_AUTH_TIMEOUT_MS, 120000)) || 120000;
  const tempMailOptions = options.tempMail || {};
  const onProgress = options.onProgress || (() => {});

  // Step 1: 获取注册配置
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

  // 如果注册页需要 Turnstile 且未手动提供 token，自动调用 solver
  let resolvedTurnstileToken = turnstileToken;
  if (pageConfig && pageConfig.turnstile_site_key && !resolvedTurnstileToken) {
    onProgress({ step: 'turnstile_solve', status: 'running', siteKey: pageConfig.turnstile_site_key });
    console.log('[auto-register] 检测到 Turnstile 验证，自动求解中...');
    const solverResult = await solveTurnstile(`${authUrl}/en/signup`, {
      timeoutMs: Number(process.env.TURNSTILE_TIMEOUT_MS || 90000),
    });
    if (solverResult.success && solverResult.token) {
      resolvedTurnstileToken = solverResult.token;
      onProgress({ step: 'turnstile_solve', status: 'done' });
      console.log('[auto-register] Turnstile 求解成功');
    } else {
      const message = `Turnstile 自动求解失败: ${solverResult.error || '未知错误'}`;
      onProgress({ step: 'turnstile_solve', status: 'error', error: message });
      throw new Error(`注册失败: ${message}`);
    }
  }

  // Step 2: 创建临时邮箱
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

  // Step 3: 注册
  onProgress({ step: 'signup', status: 'running' });
  let signupResult;
  try {
    signupResult = await signup(email, password, {
      jar,
      authUrl,
      pageConfig,
      turnstileToken: resolvedTurnstileToken,
      inviteToken,
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
      timeoutMs: pollTimeoutMs,
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
  browserLaunchOptions,
  checkBrowserRuntime,
  completeVscodeConnect,
  extractApiKeyToken,
  visitVerificationLink,
};
