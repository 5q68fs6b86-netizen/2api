'use strict';

const { CookieJar, request } = require('./httpClient');
const { DEFAULT_TEMP_MAIL_DOMAIN, createTempEmail, waitForVerificationEmail } = require('./tempMail');

const KOMBAI_AUTH_URL = process.env.KOMBAI_AUTH_URL || 'https://auth.kombai.com';
const DEFAULT_USER_AGENT = process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function makePassword(seed = Math.random().toString(36).slice(2, 10)) {
  return `K0mb@i_${seed}A1!`;
}

function makeEmailName(prefix = 'kombai') {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

function authHeaders(jar, referer) {
  const cookie = jar.header();
  return {
    'Content-Type': 'application/json',
    'X-CSRF-Token': '-.-',
    Origin: KOMBAI_AUTH_URL,
    Referer: referer || `${KOMBAI_AUTH_URL}/en/signup`,
    'User-Agent': DEFAULT_USER_AGENT,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function extractNextData(html) {
  const match = html.match(/<script\b(?=[^>]*\bid="__NEXT_DATA__")[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  return JSON.parse(match[1]);
}

async function getSignupConfig(jar = new CookieJar()) {
  const resp = await request(`${KOMBAI_AUTH_URL}/en/signup`, {
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
  const config = options.skipConfig ? { pageConfig: null } : await getSignupConfig(jar);
  const pageConfig = config.pageConfig;
  const turnstileSiteKey = pageConfig ? pageConfig.turnstile_site_key : null;

  if (turnstileSiteKey && !options.turnstileToken) {
    throw new Error(`注册页需要 Turnstile token: ${turnstileSiteKey}`);
  }

  const body = {
    email,
    password,
    ...(options.turnstileToken ? { turnstile_token: options.turnstileToken } : {}),
    ...(options.inviteToken ? { invite_token: options.inviteToken } : {}),
  };

  const resp = await request(`${KOMBAI_AUTH_URL}/api/fe/v2/signup`, {
    method: 'POST',
    headers: authHeaders(jar, `${KOMBAI_AUTH_URL}/en/signup`),
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
  const resp = await request(`${KOMBAI_AUTH_URL}/api/fe/v1/login`, {
    method: 'POST',
    headers: authHeaders(jar, `${KOMBAI_AUTH_URL}/en/login`),
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
  const tempEmail = options.email
    ? null
    : await createTempEmail(emailName, options.tempMail);
  const email = options.email || (tempEmail ? tempEmail.address : `${emailName}@${DEFAULT_TEMP_MAIL_DOMAIN}`);
  const jar = new CookieJar();

  const signupResult = await signup(email, password, {
    jar,
    turnstileToken: options.turnstileToken,
    inviteToken: options.inviteToken,
  });

  let verification = null;
  if (signupResult.success && tempEmail && options.waitForVerification) {
    verification = await waitForVerificationEmail(tempEmail.address, tempEmail.jwt, options.tempMail);
  }

  const loginResult = signupResult.success && options.login !== false
    ? await login(email, password, { jar })
    : null;

  return {
    success: signupResult.success,
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
  getSignupConfig,
  login,
  makeEmailName,
  makePassword,
  registerAccount,
  signup,
};
