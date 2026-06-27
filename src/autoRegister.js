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
 * 在已登录状态下访问 vscode-connect URL，让浏览器自动完成重定向
 */
async function completeVscodeConnect(connectUrl, cookies = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: DEFAULT_USER_AGENT });
  const page = await context.newPage();

  try {
    // 设置 auth cookies
    const hostname = new URL(connectUrl).hostname;
    const cookieList = Object.entries(cookies).map(([name, value]) => ({
      name,
      value: String(value),
      domain: hostname,
      path: '/',
    }));
    if (cookieList.length > 0) {
      await context.addCookies(cookieList);
    }

    await page.goto(connectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // 等待重定向完成
    await page.waitForTimeout(8000);

    const url = page.url();
    const text = await page.textContent('body').catch(() => '');

    return {
      url,
      pageText: (text || '').substring(0, 500),
    };
  } catch (error) {
    return { error: error.message };
  } finally {
    await browser.close();
  }
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
    connectResult = await completeVscodeConnect(connectAuth.url, cookies);
    onProgress({
      step: 'browser_connect',
      status: 'done',
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
