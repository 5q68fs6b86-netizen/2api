'use strict';

const { CookieJar, request } = require('./httpClient');
const { DEFAULT_TEMP_MAIL_DOMAIN, createTempEmail, waitForVerificationEmail } = require('./tempMail');

const DEFAULT_KOMBAI_AUTH_URL = process.env.KOMBAI_AUTH_URL || 'https://auth.kombai.com';
const DEFAULT_USER_AGENT = process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function makePassword(seed = Math.random().toString(36).slice(2, 10)) {
  return `K0mb@i_${seed}A1!`;
}

function makeEmailName(prefix = 'kombai') {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAuthUrl(authUrl = DEFAULT_KOMBAI_AUTH_URL) {
  return String(authUrl).replace(/\/+$/, '');
}

function authHeaders(jar, referer, authUrl = DEFAULT_KOMBAI_AUTH_URL) {
  const baseUrl = normalizeAuthUrl(authUrl);
  const cookie = jar.header();
  return {
    'Content-Type': 'application/json',
    'X-CSRF-Token': '-.-',
    Origin: baseUrl,
    Referer: referer || `${baseUrl}/en/signup`,
    'User-Agent': DEFAULT_USER_AGENT,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function extractNextData(html) {
  const match = html.match(/<script\b(?=[^>]*\bid="__NEXT_DATA__")[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  return JSON.parse(match[1]);
}

async function getSignupConfig(options = {}) {
  const jar = options.jar || new CookieJar();
  const authUrl = normalizeAuthUrl(options.authUrl);
  const resp = await request(`${authUrl}/en/signup`, {
    headers: { 'User-Agent': DEFAULT_USER_AGENT },
  });
  jar.addFromHeaders(resp.headers['set-cookie']);

  if (resp.status < 200 || resp.status >= 400) {
    throw new Error(`获取注册页失败: HTTP ${resp.status}`);
  }

  const nextData = extractNextData(resp.text);
  return {
    jar,
    nextData,
    pageConfig: nextData && nextData.props && nextData.props.pageProps
      ? nextData.props.pageProps.pageConfig
      : null,
  };
}

async function signup(email, password, options = {}) {
  const jar = options.jar || new CookieJar();
  const authUrl = normalizeAuthUrl(options.authUrl);
  const config = options.pageConfig
    ? { pageConfig: options.pageConfig }
    : options.skipConfig
      ? { pageConfig: null }
      : await getSignupConfig({ jar, authUrl });
  const pageConfig = config.pageConfig;
  const turnstileSiteKey = pageConfig ? pageConfig.turnstile_site_key : null;

  if (turnstileSiteKey && !options.turnstileToken) {
    return {
      success: false,
      status: 0,
      errorType: 'turnstile_required',
      error: { message: '注册页需要 Turnstile token', siteKey: turnstileSiteKey },
      jar,
      pageConfig,
    };
  }

  const body = {
    email,
    password,
    ...(options.turnstileToken ? { turnstile_token: options.turnstileToken } : {}),
    ...(options.inviteToken ? { invite_token: options.inviteToken } : {}),
  };

  const resp = await request(`${authUrl}/api/fe/v2/signup`, {
    method: 'POST',
    headers: authHeaders(jar, `${authUrl}/en/signup`, authUrl),
    body,
  });
  jar.addFromHeaders(resp.headers['set-cookie']);

  if (resp.status === 200 && resp.data && resp.data.user_id) {
    return { success: true, userId: resp.data.user_id, status: resp.status, jar, pageConfig };
  }

  if (resp.status === 400) {
    return { success: false, status: resp.status, errorType: 'bad_request', error: resp.data, jar, pageConfig };
  }

  return { success: false, status: resp.status, errorType: 'unexpected_error', error: resp.data || resp.text, jar, pageConfig };
}

async function login(email, password, options = {}) {
  const jar = options.jar || new CookieJar();
  const authUrl = normalizeAuthUrl(options.authUrl);
  const resp = await request(`${authUrl}/api/fe/v1/login`, {
    method: 'POST',
    headers: authHeaders(jar, `${authUrl}/en/login`, authUrl),
    body: { email, password },
  });
  jar.addFromHeaders(resp.headers['set-cookie']);

  if (resp.status === 200 && resp.data && resp.data.user_id) {
    return { success: true, userId: resp.data.user_id, status: resp.status, jar };
  }

  return { success: false, status: resp.status, error: resp.data || resp.text, jar };
}

async function registerAccount(options = {}) {
  const emailName = options.emailName || makeEmailName(options.emailPrefix);
  const password = options.password || makePassword(emailName.slice(-8));
  const authUrl = normalizeAuthUrl(options.authUrl);
  const jar = new CookieJar();
  const config = options.skipConfig ? { pageConfig: null } : await getSignupConfig({ jar, authUrl });
  const turnstileSiteKey = config.pageConfig ? config.pageConfig.turnstile_site_key : null;

  if (turnstileSiteKey && !options.turnstileToken) {
    return {
      success: false,
      authUrl,
      email: options.email || null,
      password: options.password || null,
      tempEmail: null,
      signup: {
        success: false,
        status: 0,
        errorType: 'turnstile_required',
        error: { message: '注册页需要 Turnstile token', siteKey: turnstileSiteKey },
        requiresTurnstile: true,
      },
      verification: null,
      login: null,
      cookies: jar.toJSON(),
    };
  }

  const tempEmail = options.email
    ? null
    : await createTempEmail(emailName, options.tempMail);
  const email = options.email || (tempEmail ? tempEmail.address : `${emailName}@${DEFAULT_TEMP_MAIL_DOMAIN}`);

  const signupResult = await signup(email, password, {
    jar,
    authUrl,
    pageConfig: config.pageConfig,
    skipConfig: options.skipConfig,
    turnstileToken: options.turnstileToken,
    inviteToken: options.inviteToken,
  });

  let verification = null;
  if (signupResult.success && tempEmail && options.waitForVerification) {
    verification = await waitForVerificationEmail(tempEmail.address, tempEmail.jwt, options.tempMail);
  }

  const loginResult = signupResult.success && options.login !== false
    ? await login(email, password, { jar, authUrl })
    : null;

  return {
    success: signupResult.success,
    authUrl,
    email,
    password,
    tempEmail,
    signup: {
      success: signupResult.success,
      status: signupResult.status,
      userId: signupResult.userId,
      errorType: signupResult.errorType,
      error: signupResult.error,
      requiresTurnstile: !!(signupResult.pageConfig && signupResult.pageConfig.turnstile_site_key),
    },
    verification,
    login: loginResult && {
      success: loginResult.success,
      status: loginResult.status,
      userId: loginResult.userId,
      error: loginResult.error,
    },
    cookies: jar.toJSON(),
  };
}

module.exports = {
  DEFAULT_KOMBAI_AUTH_URL,
  getSignupConfig,
  login,
  makeEmailName,
  makePassword,
  normalizeAuthUrl,
  registerAccount,
  signup,
};
