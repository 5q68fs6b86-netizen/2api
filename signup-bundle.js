(self.webpackChunk_N_E = self.webpackChunk_N_E || []).push([
  [2987],
  {
    73576: function (e, r, t) {
      (window.__NEXT_P = window.__NEXT_P || []).push([
        "/en/signup",
        function () {
          return t(23036);
        },
      ]);
    },
    12822: function (e, r, t) {
      "use strict";
      t.d(r, {
        o: function () {
          return formatErrors;
        },
      });
      var n = t(85893);
      function formatErrors(e) {
        if (!e) return {};
        let r = {};
        for (let t in e) {
          let s = e[t];
          Array.isArray(s)
            ? (r[t] = (0, n.jsx)(n.Fragment, { children: s.map((e, r) => (0, n.jsx)("div", { children: e }, r)) }))
            : (r[t] = s);
        }
        return r;
      }
      t(67294);
    },
    54254: function (e, r, t) {
      "use strict";
      t.d(r, {
        Q: function () {
          return apiSignup;
        },
      });
      var n = t(1448);
      function apiSignup(e) {
        return (0, n.j0)("/api/fe/v2/signup", e).then((e) =>
          e.ok
            ? e.json().then((e) => ({ success: !0, data: { user_id: e.user_id } }))
            : 400 === e.status
              ? e.json().then((e) => (0, n.Nr)(e))
              : (0, n.xo)(),
        );
      }
    },
    89690: function (e, r, t) {
      "use strict";
      var n = t(85893),
        s = t(40423);
      r.Z = function (e) {
        let {
          displayLabels: r,
          renderForFramelessPage: t = !1,
          useDeprecatedStyle: o = !1,
          propertySettings: i,
          form: a,
        } = e;
        return (0, n.jsx)(n.Fragment, {
          children: i.map((e) => {
            let i = s.Vg[e.field_type];
            return (
              !!i &&
              (0, n.jsx)(
                i,
                { renderForFramelessPage: t, useDeprecatedStyle: o, propertySetting: e, showLabel: r, form: a },
                e.name,
              )
            );
          }),
        });
      };
    },
    68281: function (e, r, t) {
      "use strict";
      t.d(r, {
        D: function () {
          return useTurnstile;
        },
      });
      var n = t(85893),
        s = t(67294);
      function useTurnstile(e) {
        let { siteKey: r } = e,
          t = (0, s.useRef)(null),
          o = (0, s.useRef)(null),
          [i, a] = (0, s.useState)(null),
          [l, u] = (0, s.useState)(null),
          g = !!r,
          d = (0, s.useCallback)(() => {
            if (!g || !t.current || !window.turnstile) return;
            if (o.current && window.turnstile.remove) {
              try {
                window.turnstile.remove(o.current);
              } catch (e) {}
              o.current = null;
            }
            (a(null), u(null));
            let e = window.turnstile.render(t.current, {
              sitekey: r,
              callback: (e) => a(e),
              "error-callback": (e) => {
                (console.error("Turnstile error:", e), u("Challenge failed, please try again."));
              },
              "expired-callback": () => a(null),
              "refresh-expired": "auto",
              retry: "auto",
            });
            o.current = e;
          }, [g, r]);
        ((0, s.useEffect)(() => {
          if (!g) return;
          if (window.turnstile) {
            d();
            return;
          }
          let e = Date.now(),
            r = setInterval(() => {
              if (window.turnstile) {
                (clearInterval(r), d());
                return;
              }
              Date.now() - e > 1e4 && (clearInterval(r), u("Challenge failed to load. Please refresh and try again."));
            }, 50);
          return () => clearInterval(r);
        }, [g, d]),
          (0, s.useEffect)(
            () => () => {
              var e;
              let r = o.current;
              if (r && (null === (e = window.turnstile) || void 0 === e ? void 0 : e.remove))
                try {
                  window.turnstile.remove(r);
                } catch (e) {}
              o.current = null;
            },
            [],
          ));
        let c = (0, s.useCallback)(() => {
            let e = o.current;
            if (e && window.turnstile) {
              try {
                window.turnstile.reset(e);
              } catch (e) {}
              (a(null), u(null));
            }
          }, []),
          p = (0, s.useMemo)(() => (r ? (0, n.jsx)("div", { ref: t }, r) : null), [r]);
        return { hasTurnstile: !!r, turnstileComponent: p, turnstileToken: i, turnstileError: l, resetTurnstile: c };
      }
    },
    23036: function (e, r, t) {
      "use strict";
      (t.r(r),
        t.d(r, {
          __N_SSP: function () {
            return R;
          },
          default: function () {
            return en_signup;
          },
        }));
      var n = t(85893),
        s = t(97564),
        o = t(95117),
        i = t(40423),
        a = t(31908),
        l = t(67841),
        u = t(11163),
        g = t(54070),
        d = t(94806),
        c = t(73193),
        p = t(20966),
        m = t(77248),
        _ = t(33575),
        f = t(47037),
        h = t.n(f),
        w = t(67294),
        S = t(12822),
        x = t(1448),
        v = t(54254),
        y = t(70781),
        j = t(68281),
        b = t(1776),
        L = t(95427),
        k = t(11180),
        P = t(80061),
        I = t(65086),
        F = t(89690),
        Deprecated_DeprecatedPasswordSignup = (e) => {
          let {
            form: r,
            displayLabels: t,
            areButtonsDisabled: o,
            isLoading: a,
            legacyPropertySettings: u,
            propertySettings: d,
            handleSubmit: c,
          } = e;
          return (0, n.jsx)("form", {
            onSubmit: r.onSubmit(c),
            children: (0, n.jsxs)(s.K, {
              mt: "lg",
              children: [
                (0, n.jsx)(F.Z, { useDeprecatedStyle: !0, displayLabels: t, propertySettings: u, form: r }),
                (0, n.jsx)(I.Z, { useDeprecatedStyle: !0, showLabel: t, form: r }),
                (0, n.jsx)(P.o, {
                  variant: g.kI.LoginDeprecated,
                  label: t ? "Password" : void 0,
                  placeholder: t ? void 0 : "Password",
                  type: "password",
                  autoComplete: "new-password",
                  required: t,
                  ...r.getInputProps(i.gr.Password),
                }),
                (0, n.jsx)(F.Z, { useDeprecatedStyle: !0, displayLabels: t, propertySettings: d, form: r }),
                (0, n.jsx)(l.z, {
                  variant: g.Bq.LoginPrimary,
                  mt: "lg",
                  type: "submit",
                  fullWidth: !0,
                  disabled: o,
                  children: a ? (0, n.jsx)(p.a, { color: g.xR.LoginSuccessButtonColor, size: "sm" }) : "Sign Up",
                }),
              ],
            }),
          });
        },
        login_PasswordSignup = (e) => {
          let { pageConfig: r, providedEmail: t } = e,
            { classes: o } = (0, L.fc)(),
            a = (0, u.useRouter)(),
            { posthogClient: d } = (0, y.r)(),
            [f, P] = (0, w.useState)(!1),
            {
              hasTurnstile: C,
              turnstileComponent: T,
              turnstileToken: D,
              turnstileError: E,
              resetTurnstile: q,
            } = (0, j.D)({ siteKey: r.turnstile_site_key }),
            [Z, N] = (0, k.Xc)(r.require_name, r.require_username, r.user_property_settings.fields),
            O = (0, k.JI)(N),
            R = (0, m.c)({
              initialValues: {
                ...O,
                [i.gr.Email]: null != t ? t : "",
                [i.gr.Password]: "",
                [i.gr.FirstName]: "",
                [i.gr.LastName]: "",
                [i.Yf.Username]: "",
              },
              transformValues: (e) => (0, k.iy)(e, N),
            }),
            handleSubmit = async (e) => {
              P(!0);
              let t = e[i.gr.Email],
                n = e[i.gr.Password];
              if (!h()(t)) {
                (R.setFieldError("email", "Invalid email address"), P(!1));
                return;
              }
              if (!h()(n)) {
                (R.setFieldError("password", "Invalid password"), P(!1));
                return;
              }
              let s = {};
              try {
                s = (0, k.V2)(r, e, N);
              } catch (r) {
                let e = "A form error has occurred.";
                (r instanceof Error && (e = r.message),
                  _.N9.show({ title: "Error", message: e, color: g.xR.ErrorButtonColor, classNames: o }));
              }
              let l = await (0, v.Q)({
                email: t,
                password: n,
                turnstile_token: D || void 0,
                ...s,
                invite_token: (0, b.at)(),
              });
              if (l.success) {
                let { user_id: e } = l.data;
                (d && d.identify(e), (0, b.py)(), await a.push("/login"));
              } else if ("bad_request" === l.error_type) {
                let e = {
                  ...l.field_to_errors,
                  [i.Yf.Username]: l.field_to_errors[i.Yf.Username] || l.field_to_errors[i.gr.Username],
                };
                (R.setErrors((0, S.o)(e)), q(), P(!1));
              } else
                (_.N9.show({ title: "Error", message: x.aK, color: g.xR.ErrorButtonColor, classNames: o }), q(), P(!1));
            },
            B = f || (C && !D) || (C && !!E),
            U =
              r.user_property_settings.fields.filter((e) => {
                let r = e.is_enabled && e.collect_on_signup,
                  t = [i.Yf.Name, i.Yf.Username, i.gr.Tos, i.Yf.PictureUrl].includes(e.name);
                return r && !t;
              }).length > 0,
            z = r.use_deprecated_login_ui,
            A = r.theme.login_ui_theme === i.gq.Frameless;
          return z
            ? (0, n.jsx)(Deprecated_DeprecatedPasswordSignup, {
                form: R,
                displayLabels: U,
                areButtonsDisabled: B,
                isLoading: f,
                legacyPropertySettings: Z,
                propertySettings: N,
                handleSubmit: handleSubmit,
              })
            : (0, n.jsx)("form", {
                onSubmit: R.onSubmit(handleSubmit),
                children: (0, n.jsxs)(s.K, {
                  children: [
                    (0, n.jsxs)(s.K, {
                      spacing: "lg",
                      children: [
                        (0, n.jsx)(F.Z, { displayLabels: !0, renderForFramelessPage: A, propertySettings: Z, form: R }),
                        (0, n.jsx)(I.Z, { showLabel: !0, form: R, renderForFramelessPage: A }),
                        (0, n.jsx)(c.W, {
                          autoComplete: "new-password",
                          variant: A ? g.kI.LoginFrameless : g.kI.Login,
                          label: "Password",
                          required: !0,
                          ...R.getInputProps(i.gr.Password),
                        }),
                        (0, n.jsx)(F.Z, { displayLabels: !0, renderForFramelessPage: A, propertySettings: N, form: R }),
                        T,
                      ],
                    }),
                    (0, n.jsx)(l.z, {
                      variant: A ? g.Bq.LoginFramelessPrimary : g.Bq.LoginPrimary,
                      mt: "lg",
                      type: "submit",
                      fullWidth: !0,
                      disabled: B,
                      children: f
                        ? (0, n.jsx)(p.a, { color: g.xR.LoginSuccessButtonColor, size: "sm" })
                        : "Sign up with email",
                    }),
                  ],
                }),
              });
        },
        C = t(33614),
        Deprecated_DeprecatedSignupPage = (e) => {
          let { pageConfig: r, pageType: t, renderSignInOptions: s, renderDivider: o, renderPasswordSignup: i } = e,
            c = (0, u.useRouter)();
          return (0, n.jsxs)(a.ZP, {
            pageConfig: r,
            pageTitle: "Sign Up",
            title: "Create an account",
            pageType: t,
            bottomChild: (0, n.jsx)(l.z, {
              onClick: () => c.push("/login"),
              variant: g.Bq.TextOld,
              p: 0,
              children: "Already have an account? Log in",
            }),
            children: [
              s && (0, n.jsx)(C.Z, { useDeprecatedPage: !0, pageConfig: r }),
              o && (0, n.jsx)(d.Z, { useDeprecatedStyle: !0, isFrameless: !1 }),
              i && (0, n.jsx)(login_PasswordSignup, { pageConfig: r }),
            ],
          });
        },
        T = t(66137),
        D = t(54685),
        E = t(41664),
        q = t.n(E),
        Z = t(48552),
        LoginFooters_DefaultSignupShellFooter = (e) => {
          let { loginUITheme: r, useSignupOverLogin: t } = e,
            s = r === i.gq.SplitScreen,
            a = s ? g.kI.Login : g.kI.LoginFrameless,
            l = s ? g.xR.LoginForegroundTextColor : g.xR.LoginBackgroundTextColor,
            d = (0, u.useRouter)(),
            { isPageEnabled: c } = (0, Z.z)();
          return c(i.Aj.Login)
            ? (0, n.jsxs)(T.Z, {
                noWrap: !0,
                position: "center",
                w: "100%",
                children: [
                  (0, n.jsx)(o.x, { color: l, size: "lg", children: "Already have an account? " }),
                  (0, n.jsx)(D.e, {
                    tabIndex: 2,
                    component: q(),
                    href: { pathname: "/login", query: { ...d.query } },
                    variant: a,
                    fw: 500,
                    size: "lg",
                    children: t ? "Sign in" : "Log in",
                  }),
                ],
              })
            : null;
        },
        N = t(16393),
        O = t(73758),
        R = !0,
        en_signup = (e) => {
          var r;
          let { pageConfig: t, pageType: l, base64Email: u } = e,
            c = t.use_deprecated_login_ui,
            p = t.theme.login_ui_theme === i.gq.Frameless,
            m =
              t.has_passwordless_login &&
              t.has_otp_login &&
              !t.has_github_login &&
              !t.has_linkedin_login &&
              !t.has_google_login &&
              !t.has_microsoft_login &&
              !t.has_slack_login &&
              !t.has_xero_login &&
              !t.has_quickbooks_login &&
              !t.has_salesforce_login &&
              !t.has_sso_login,
            _ = !m && (t.has_any_social_login || t.has_passwordless_login || t.has_sso_login),
            f = t.has_password_login,
            h = _ && f,
            w = !_ && !f,
            [S, x] = (0, k.Xc)(t.require_name, t.require_username, t.user_property_settings.fields),
            v = S.length + x.length,
            y = u ? (0, O.TI)(u) : void 0,
            j = _ && (0, n.jsx)(C.Z, { showSignInOptions: !0, pageConfig: t, signup: !0 }),
            b = f && (0, n.jsx)(login_PasswordSignup, { pageConfig: t, providedEmail: y });
          if (v > 3) {
            let e = b;
            ((b = j), (j = e));
          }
          return c
            ? (0, n.jsx)(Deprecated_DeprecatedSignupPage, {
                pageConfig: t,
                pageType: l,
                renderSignInOptions: _,
                renderDivider: h,
                renderPasswordSignup: f,
              })
            : (0, n.jsxs)(a.ZP, {
                pageConfig: t,
                pageTitle: "Sign Up",
                title: w ? "" : "Create an account",
                pageType: l,
                bottomChild: w
                  ? void 0
                  : (0, n.jsxs)(s.K, {
                      spacing: "xs",
                      children: [
                        (0, n.jsx)(LoginFooters_DefaultSignupShellFooter, {
                          loginUITheme: t.theme.login_ui_theme,
                          useSignupOverLogin:
                            (null === (r = t.customer_overrides) || void 0 === r ? void 0 : r.use_signup_over_login) ||
                            !1,
                        }),
                        (0, n.jsx)(N.Z, { theme: t.theme }),
                      ],
                    }),
                children: [
                  j,
                  h && (0, n.jsx)(d.Z, { showDivider: _, isFrameless: p }),
                  b,
                  w &&
                    (0, n.jsx)(o.x, {
                      color: g.xR.ErrorButtonColor,
                      align: "center",
                      children: "There are no signup options enabled. Contact your administrator to set one up.",
                    }),
                ],
              });
        };
    },
    1776: function (e, r, t) {
      "use strict";
      t.d(r, {
        Ql: function () {
          return setOrgInvitationTokenInLocalStorage;
        },
        at: function () {
          return getOrgInvitationTokenFromLocalStorage;
        },
        py: function () {
          return removeOrgInvitationTokenFromLocalStorage;
        },
      });
      let n = "org_invitation_token",
        getOrgInvitationTokenFromLocalStorage = () => {
          var e;
          return null !== (e = localStorage.getItem(n)) && void 0 !== e ? e : void 0;
        },
        setOrgInvitationTokenInLocalStorage = (e) => {
          localStorage.setItem(n, e);
        },
        removeOrgInvitationTokenFromLocalStorage = () => {
          localStorage.removeItem(n);
        };
    },
  },
  function (e) {
    (e.O(0, [3972, 7248, 5652, 9748, 9774, 2888, 179], function () {
      return e((e.s = 73576));
    }),
      (_N_E = e.O()));
  },
]);
