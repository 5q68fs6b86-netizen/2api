"use strict";
(self.webpackChunk_N_E = self.webpackChunk_N_E || []).push([
  [9748],
  {
    79180: function (e, o, n) {
      n.d(o, {
        X: function () {
          return apiCheckOrgForSaml;
        },
      });
      var t = n(1448);
      async function apiCheckOrgForSaml(e) {
        return (0, t.A_)("/api/fe/v3/login/check", e).then((e) =>
          e.ok
            ? e.json().then((e) => ({ success: !0, data: e }))
            : 404 === e.status
              ? { success: !1, error_type: "org_not_found" }
              : 409 === e.status
                ? { success: !1, error_type: "ambiguous_results" }
                : (0, t.xo)(),
        );
      }
    },
    1448: function (e, o, n) {
      n.d(o, {
        A_: function () {
          return getRequest;
        },
        GH: function () {
          return putRequest;
        },
        Jl: function () {
          return deleteRequest;
        },
        Ll: function () {
          return patchRequest;
        },
        Nr: function () {
          return createBadResponse;
        },
        Yg: function () {
          return createUnauthorizedResponse;
        },
        aK: function () {
          return t;
        },
        j0: function () {
          return postRequest;
        },
        ww: function () {
          return r;
        },
        xo: function () {
          return createUnexpectedErrorResponse;
        },
      });
      let getStandardHeaders = (e) => {
          let o = { "Content-Type": "application/json", "X-CSRF-Token": "-.-" };
          return (e && (o["X-SAML-Code"] = e), o);
        },
        getGetRequestHeaders = (e) => {
          let o = { "Content-Type": "application/json" };
          return (e && (o["X-SAML-Code"] = e), o);
        },
        t = "An unexpected error has occurred, please try again",
        r = "予期しないエラーが発生しました。もう一度お試しください。",
        postRequest = (e, o, n) =>
          fetch(e, { method: "POST", headers: getStandardHeaders(n), body: JSON.stringify(o) }),
        patchRequest = (e, o, n) =>
          fetch(e, { method: "PATCH", headers: getStandardHeaders(n), body: JSON.stringify(o) }),
        deleteRequest = (e, o, n) =>
          fetch(e, { method: "DELETE", headers: getStandardHeaders(n), body: JSON.stringify(o) }),
        getRequest = (e, o, n, t) => {
          let r = new URLSearchParams(o);
          return fetch("".concat(e, "?").concat(r.toString()), {
            method: "GET",
            headers: getGetRequestHeaders(n),
            redirect: t ? "follow" : "error",
          });
        },
        putRequest = (e, o, n) => fetch(e, { method: "PUT", headers: getStandardHeaders(n), body: JSON.stringify(o) }),
        createBadResponse = (e, o) => ({
          success: !1,
          error_type: "bad_request",
          field_to_errors: e,
          overall_errors: o,
        }),
        createUnexpectedErrorResponse = () => ({ success: !1, error_type: "unexpected_error" }),
        createUnauthorizedResponse = () => ({ success: !1, error_type: "unauthorized" });
    },
    50508: function (e, o, n) {
      n.d(o, {
        V: function () {
          return apiLogin;
        },
      });
      var t = n(1448);
      function apiLogin(e) {
        let o,
          n,
          r,
          { emailOrUsername: i, password: s, useUsernameOverEmail: a } = e;
        return ((!i || i.length < 1) && (o = a ? ["Username required"] : ["Email required"]),
        s || (n = ["Password required"]),
        o || n)
          ? a
            ? Promise.resolve((0, t.Nr)({ username: o, password: n }))
            : Promise.resolve((0, t.Nr)({ email: o, password: n }))
          : ((r = a ? { username: i, password: s } : { email: i, password: s }),
            (0, t.j0)("/api/fe/v1/login", r).then((e) =>
              e.ok
                ? e.json().then((e) => ({ success: !0, data: { user_id: e.user_id } }))
                : 400 === e.status
                  ? e
                      .json()
                      .then((e) => (0, t.Nr)({ email: e.email, password: e.password, username: e.username }, e.error))
                  : 404 === e.status
                    ? e.text().then((e) => ({ success: !1, error_type: "login_not_found", message: e }))
                    : (0, t.xo)(),
            ));
      }
    },
    53658: function (e, o, n) {
      var t = n(85893),
        r = n(56817),
        i = n(64761),
        s = n(66137),
        a = n(17789),
        l = n(95117),
        c = n(97564),
        d = n(84530),
        g = n(67294),
        u = n(40423),
        h = n(54070);
      let p = (0, r.k)((e) => ({
        badge: {
          padding: "".concat(e.spacing.md, " ").concat(e.spacing.lg),
          borderRadius: e.radius.md,
          height: "100%",
          pointerEvents: "auto",
          cursor: "pointer",
        },
        poweredBy: { backgroundColor: e.colors.propelAuthGreen[6], color: e.colors.propelAuthWhite[6] },
      }));
      o.Z = (e) => {
        let { isDesktop: o, showNavbar: n } = e,
          { cx: r, classes: x } = p(),
          m = (0, i.rZ)(),
          [f, w] = (0, g.useState)("");
        (0, g.useEffect)(() => {
          w(window.location.hostname || "");
        }, []);
        let j = n
          ? "calc(100vw - ".concat(o ? "300px" : "0px", " - (2 * ").concat(m.spacing.md, "))")
          : "calc(100vw - (2 * ".concat(m.spacing.md, "))");
        return (0, t.jsx)(s.Z, {
          style: { width: j, height: "auto", zIndex: 10, pointerEvents: "none" },
          px: { base: "sm", sm: "xl" },
          py: { base: "xs", sm: "lg" },
          pos: "fixed",
          align: "end",
          position: "right",
          bottom: m.spacing.md,
          children: (0, t.jsx)(a.C, {
            tabIndex: 10,
            component: "a",
            href: "https://www.propelauth.com?utm_campaign=poweredby&utm_source=".concat(f),
            target: "_blank",
            rel: "noopener noreferrer",
            className: r(x.badge, x.poweredBy),
            children: o
              ? (0, t.jsxs)(s.Z, {
                  children: [
                    (0, t.jsx)(d.Z, { size: m.other.iconSizes.md }),
                    (0, t.jsx)(l.x, {
                      size: "md",
                      ff: h.dn[u.bt.Inter].style.fontFamily,
                      children: "Powered by PropelAuth",
                    }),
                  ],
                })
              : (0, t.jsxs)(c.K, {
                  align: "center",
                  spacing: 0,
                  p: 0,
                  m: 0,
                  children: [
                    (0, t.jsx)(l.x, { size: "xs", ff: h.dn[u.bt.Inter].style.fontFamily, children: "Powered by" }),
                    (0, t.jsx)(l.x, { size: "sm", ff: h.dn[u.bt.Inter].style.fontFamily, children: "PropelAuth" }),
                  ],
                }),
          }),
        });
      };
    },
    31908: function (e, o, n) {
      n.d(o, {
        yS: function () {
          return Z;
        },
        H1: function () {
          return z;
        },
        ZP: function () {
          return LoginPageShell_LoginPageShell;
        },
      });
      var t,
        r,
        i = n(85893),
        s = n(98664),
        a = n(80353),
        l = n(34065),
        c = n(49110),
        d = n(53395),
        g = n(64761),
        u = n(71298),
        h = n(18540),
        p = n(66137),
        x = n(73723),
        m = n(72445),
        f = n(97564),
        w = n(19236),
        j = n(95117),
        L = n(43523),
        _ = n(67294),
        S = n(40423),
        customer_DagworksPageTitle = () =>
          (0, i.jsxs)("div", {
            style: { maxWidth: "500px", margin: "0px" },
            children: [
              (0, i.jsx)("h3", {
                style: {
                  textAlign: "center",
                  fontWeight: 700,
                  fontSize: "38px",
                  letterSpacing: "-2px",
                  marginBottom: "5px",
                },
                children: "Welcome to DAGWorks!",
              }),
              (0, i.jsxs)("p", {
                style: { textAlign: "center", fontSize: "14px", lineHeight: "22px", marginBottom: "25px" },
                children: [
                  "Sign up to get started with a 14-day trial of the team plan. After that, select a",
                  " ",
                  (0, i.jsx)("a", {
                    style: { color: "black" },
                    href: "https://www.dagworks.io/pricing",
                    children: "plan",
                  }),
                  ", or continue to use the community plan for free.",
                ],
              }),
            ],
          }),
        v = n(82623),
        y = n(54070),
        b = n(92916),
        customer_GovEagleLoginWarning = (e) => {
          let { maxContentWidth: o, minContentWidth: n, isFrameless: t, isSplit: r, isMobile: s = !1 } = e,
            a = (0, g.rZ)(),
            l = r || t ? "xl" : "0px",
            c = t ? o : "calc(".concat(o, " + 2 * ").concat(a.spacing.xl, ")"),
            d = (0, b.wX)(a, r ? y.xR.LoginForegroundColor : y.xR.LoginBackgroundColor),
            u = (0, b._T)(d) ? a.fn.lighten(d, 0.1) : a.fn.darken(d, 0.1),
            h = (0, b.wX)(a, r ? y.xR.LoginForegroundTextColor : y.xR.LoginBackgroundTextColor),
            p = (0, b.e5)(h, u);
          return (0, i.jsx)(v.X, {
            w: "100%",
            maw: s ? "min(100%, ".concat(c, ")") : c,
            miw: s ? "min(100%, ".concat(n, ")") : n,
            p: t ? "0px" : "xl",
            mt: "lg",
            bg: u,
            style: { border: "none" },
            children: (0, i.jsxs)(f.K, {
              p: l,
              children: [
                (0, i.jsx)(L.M, { children: (0, i.jsx)(w.D, { color: p, order: 4, children: "WARNING" }) }),
                (0, i.jsx)(j.x, {
                  color: p,
                  children:
                    "You are accessing a U.S. Government system that may contain Controlled Unclassified Information (CUI). Unauthorized use is prohibited and may result in penalties. By logging in, you consent to monitoring and agree to comply with security and privacy policies.",
                }),
              ],
            }),
          });
        },
        k = n(69432),
        C = n(52569),
        hooks_useLogoOffset = (e) => {
          let { showHeader: o, showLogo: n, logoRef: t, contentRef: r, spacing: i } = e,
            s = (0, g.rZ)(),
            [a, l] = (0, _.useState)("0px"),
            [c, d] = (0, _.useState)(!1);
          return (
            (0, _.useEffect)(() => {
              let e = o ? C.x : 0,
                a = n && t.current && r.current && r.current.offsetTop - t.current.offsetHeight > (0, u.px)(i) + e;
              if (a) {
                var c;
                l(
                  "calc(-"
                    .concat(null !== (c = t.current.offsetHeight) && void 0 !== c ? c : "0", "px - ")
                    .concat(s.spacing.lg, ")"),
                );
              }
              d(!0);
            }, [s.spacing.lg, n, c, i, o, t, r]),
            { yOffset: a, showContent: c }
          );
        },
        R = n(99748);
      let getBackgroundStyles = function (e, o) {
        let n = arguments.length > 2 && void 0 !== arguments[2] && arguments[2],
          t = e.other.loginUITheme === S.gq.SplitScreen,
          r = (0, b.wX)(e, y.xR.LoginForegroundColor),
          i = e.other.backgroundType === S.ez.Solid,
          s = e.other.backgroundType === S.ez.Image,
          a = e.other.backgroundType === S.ez.ImageSvg,
          l = (0, b.wX)(e, y.xR.LoginBackgroundColor),
          c = (0, b.wX)(e, y.xR.LoginSecondaryBackgroundColor),
          d = e.fn.linearGradient(e.other.gradientAngle, l, c);
        s
          ? (d = "url(".concat("dark" === o ? "/api/v1/bg_dark.png" : "/api/v1/bg.png", ")"))
          : a && (d = "url(".concat("dark" === o ? "/api/v1/bg_dark.svg" : "/api/v1/bg.svg", ")"));
        let g = n && t,
          u = {
            backgroundPosition: "center",
            backgroundColor: g ? r : void 0,
            backgroundImage: i || g ? void 0 : d,
            backgroundSize: "cover",
          };
        return u;
      };
      var ContentWrappers_LoginPageContentWrapperDesktop = (e) => {
          let { children: o, maxContentWidth: n, minContentWidth: t, isFrameless: r } = e,
            s = (0, g.rZ)(),
            a = r ? m.W : v.X,
            l = r ? n : "calc(".concat(n, " + 2 * ").concat(s.spacing.xl, " + 2px)");
          return (0, i.jsx)(a, {
            variant: y.kI.LoginFrameless,
            w: "100%",
            maw: l,
            miw: t,
            p: r ? "0px" : "xl",
            m: 0,
            children: o,
          });
        },
        Deprecated_DeprecatedLoginPageShellResponsiveLg = (e) => {
          let { maxContentWidth: o, showLogo: n, logoUrl: t, title: r, children: s, bottomChild: a, pageType: l } = e,
            c = (0, g.rZ)(),
            u = l === d.$Q.DAGWORKS,
            p = "calc(100vh - 2 * ".concat(c.spacing.xxl, " - ").concat(n ? z : "0", "px)");
          return (0, i.jsx)(h.z, {
            smallerThan: "lg",
            styles: { display: "none" },
            children: (0, i.jsx)(m.W, {
              p: "xxl",
              size: "xl",
              mih: "100vh",
              children: (0, i.jsxs)(f.K, {
                align: "center",
                justify: "center",
                mih: p,
                spacing: "xl",
                children: [
                  u && (0, i.jsx)(customer_DagworksPageTitle, {}),
                  !u && n && t && (0, i.jsx)(k.Z, { logoUrl: t }),
                  (0, i.jsxs)(v.X, {
                    variant: y.kI.Login,
                    maw: o,
                    miw: Z,
                    p: "20px",
                    children: [
                      !!r &&
                        (0, i.jsx)(L.M, {
                          mt: "lg",
                          mb: "xl",
                          children: (0, i.jsx)(w.D, { order: 1, fz: "22px", fw: 600, children: r }),
                        }),
                      s,
                      a && (0, i.jsx)(L.M, { mt: "lg", children: a }),
                    ],
                  }),
                ],
              }),
            }),
          });
        },
        Deprecated_DeprecatedLoginPageShellResponsiveMd = (e) => {
          let { maxContentWidth: o, showLogo: n, logoUrl: t, title: r, children: s, bottomChild: a, pageType: l } = e,
            c = (0, g.rZ)(),
            u = l === d.$Q.DAGWORKS,
            p = "calc(100vh - 2 * ".concat(c.spacing.xl, " - ").concat(n ? z : "0", "px)");
          return (0, i.jsx)(h.z, {
            smallerThan: "sm",
            styles: { display: "none" },
            children: (0, i.jsx)(h.z, {
              largerThan: "lg",
              styles: { display: "none" },
              children: (0, i.jsx)(m.W, {
                p: "xl",
                size: "md",
                mih: "100vh",
                children: (0, i.jsxs)(f.K, {
                  align: "center",
                  justify: "center",
                  mih: p,
                  spacing: "xl",
                  children: [
                    u && (0, i.jsx)(customer_DagworksPageTitle, {}),
                    !u && n && t && (0, i.jsx)(k.Z, { logoUrl: t }),
                    (0, i.jsxs)(v.X, {
                      variant: y.kI.Login,
                      maw: o,
                      miw: Z,
                      p: "20px",
                      children: [
                        !!r &&
                          (0, i.jsx)(L.M, {
                            mt: "lg",
                            mb: "xl",
                            children: (0, i.jsx)(w.D, { order: 1, fz: "22px", fw: 600, children: r }),
                          }),
                        s,
                        a && (0, i.jsx)(L.M, { mt: "lg", children: a }),
                      ],
                    }),
                  ],
                }),
              }),
            }),
          });
        },
        T = n(64523),
        Responsive_SplitscreenBackground = (e) => {
          let { isSplit: o, splitscreenContent: n } = e,
            { colorScheme: t } = (0, c.w)(),
            s = (0, g.rZ)(),
            a = getBackgroundStyles(s, t),
            l = (null == n ? void 0 : n.direction) === S.d8.Right,
            d = (null == n ? void 0 : n.content_type) === S.rG.Text,
            u = !!n && n.content_type === S.rG.Embed && !!n.embed_url;
          return (0, i.jsxs)(T.x, {
            hidden: !o,
            w: r.Large,
            h: "100%",
            style: { order: l ? 1 : 2, ...a },
            children: [
              d &&
                (0, i.jsx)(m.W, {
                  p: "xxl",
                  h: "100%",
                  children: (0, i.jsx)(L.M, {
                    h: "100%",
                    w: "100%",
                    children: (0, i.jsxs)(f.K, {
                      h: "100%",
                      w: "100%",
                      justify: "center",
                      children: [
                        (0, i.jsx)(w.D, {
                          order: 2,
                          color: y.xR.LoginBackgroundTextColor,
                          style: { fontSize: s.fontSizes.xxxl, whiteSpace: "pre-wrap", overflowWrap: "break-word" },
                          children: null == n ? void 0 : n.header,
                        }),
                        (0, i.jsx)(j.x, {
                          size: "xl",
                          color: y.xR.LoginSecondaryBackgroundTextColor,
                          style: { whiteSpace: "pre-wrap", overflowWrap: "break-word" },
                          children: null == n ? void 0 : n.subheader,
                        }),
                      ],
                    }),
                  }),
                }),
              u &&
                (0, i.jsx)("iframe", {
                  width: "100%",
                  height: "100%",
                  title: "split-iframe-content",
                  id: "signup-readonly-frame",
                  src: null == n ? void 0 : n.embed_url,
                }),
            ],
          });
        };
      (((t = r || (r = {})).Large = "61.8%"), (t.Small = "38.2%"), (t.Half = "50%"));
      let getConditionalRenderStyles = (e) => ({ opacity: e ? "100%" : "0%", transition: "100ms ease-in-out opacity" });
      var Responsive_LoginPageShellResponsiveDesktop = (e) => {
          let { colorScheme: o, setDarkModeToggleHidden: n } = (0, c.w)(),
            t = (0, g.rZ)(),
            {
              disableLogoOffset: r,
              useDeprecatedPage: s,
              maxContentWidth: a,
              showLogo: l,
              showHeader: v,
              showFooter: b,
              logoUrl: T,
              title: I,
              subtitle: E,
              pageTitle: F,
              children: P,
              bottomChild: D,
              pageType: z,
            } = e,
            q = (0, _.useRef)(null),
            B = (0, _.useRef)(null),
            { yOffset: W, showContent: A } = hooks_useLogoOffset({
              showHeader: v,
              showLogo: l,
              logoRef: q,
              contentRef: B,
              spacing: t.spacing.xxl,
            }),
            O = F === R.LOGIN_PAGE_TITLE && z === d.KZ.GOVEAGLE,
            U = z === d.$Q.DAGWORKS,
            K = t.other.loginUITheme === S.gq.Frame,
            G = t.other.loginUITheme === S.gq.SplitScreen,
            M = t.other.splitscreen,
            N = (null == M ? void 0 : M.direction) === S.d8.Right,
            H = "calc(100vh - ".concat(v ? C.x : 0, "px)"),
            V = "calc(".concat(Z, " + 2 * ").concat(t.spacing.xxl, ")"),
            X = "1px solid ".concat(t.colors[y.xR.LoginBorderColor][6]),
            Q = getConditionalRenderStyles(A),
            $ = getBackgroundStyles(t, o);
          if (s)
            return (0, i.jsxs)(i.Fragment, {
              children: [
                (0, i.jsx)(Deprecated_DeprecatedLoginPageShellResponsiveLg, { ...e }),
                (0, i.jsx)(Deprecated_DeprecatedLoginPageShellResponsiveMd, { ...e }),
              ],
            });
          let J =
            b &&
            B.current &&
            B.current.clientHeight >= window.innerHeight - 2 * (0, u.px)(t.spacing.xxl) - (v ? C.x : 0);
          return (0, i.jsx)(h.z, {
            smallerThan: "md",
            styles: { display: "none" },
            children: (0, i.jsxs)(p.Z, {
              spacing: 0,
              p: 0,
              h: "100%",
              w: "100%",
              noWrap: !0,
              style: $,
              children: [
                (0, i.jsx)(Responsive_SplitscreenBackground, { isSplit: G, splitscreenContent: M }),
                (0, i.jsx)(x.x, {
                  onScrollPositionChange: (e) => {
                    let { x: o, y: t } = e;
                    t > 0 ? n(!0) : n(!1);
                  },
                  h: H,
                  mih: "100%",
                  style: { order: N ? 2 : 1 },
                  w: G ? "38.2%" : "100%",
                  miw: V,
                  maw: G ? "50%" : "100%",
                  children: (0, i.jsx)(m.W, {
                    p: "xl",
                    size: "xl",
                    h: "100%",
                    mih: H,
                    bg: G ? y.xR.LoginForegroundColor : "transparent",
                    style: {
                      borderLeft: G && N ? X : "none",
                      borderRight: G && !N ? X : "none",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                    },
                    children: (0, i.jsxs)(f.K, {
                      ref: B,
                      style: { marginTop: r ? void 0 : W, ...Q },
                      h: "100%",
                      w: "100%",
                      align: "center",
                      justify: "center",
                      spacing: "lg",
                      mb: J ? "xxl" : 0,
                      children: [
                        U && (0, i.jsx)(customer_DagworksPageTitle, {}),
                        !U && l && T && (0, i.jsx)(k.Z, { logoUrl: T, logoRef: q }),
                        !!I &&
                          (0, i.jsxs)(f.K, {
                            align: "center",
                            spacing: "xs",
                            children: [
                              (0, i.jsx)(w.D, {
                                color: G ? y.xR.LoginForegroundTextColor : y.xR.LoginBackgroundTextColor,
                                order: 1,
                                fz: "xl",
                                fw: 600,
                                maw: e.maxTitleWidth,
                                align: "center",
                                children: I,
                              }),
                              !!E &&
                                (0, i.jsx)(j.x, {
                                  color: G ? y.xR.LoginForegroundTextColor : y.xR.LoginBackgroundTextColor,
                                  size: "lg",
                                  align: "center",
                                  maw: e.maxTitleWidth,
                                  children: E,
                                }),
                            ],
                          }),
                        (0, i.jsx)(ContentWrappers_LoginPageContentWrapperDesktop, {
                          maxContentWidth: a,
                          minContentWidth: Z,
                          isFrameless: !K,
                          children: P,
                        }),
                        D && (0, i.jsx)(L.M, { w: "100%", maw: a, miw: Z, children: D }),
                        O &&
                          (0, i.jsx)(customer_GovEagleLoginWarning, {
                            maxContentWidth: a,
                            minContentWidth: Z,
                            isSplit: G,
                            isFrameless: !K,
                          }),
                      ],
                    }),
                  }),
                }),
              ],
            }),
          });
        },
        ContentWrappers_LoginPageContentWrapperMobile = (e) => {
          let { children: o, maxContentWidth: n, minContentWidth: t, isFrameless: r } = e,
            s = (0, g.rZ)(),
            a = r ? m.W : v.X,
            l = r ? n : "calc(".concat(n, " + 2 * ").concat(s.spacing.xl, " + 2px)");
          return (0, i.jsx)(a, {
            variant: y.kI.LoginFrameless,
            w: "100%",
            maw: "min(100%, ".concat(l, ")"),
            miw: "min(100%, ".concat(t, ")"),
            p: r ? "0px" : "xl",
            children: o,
          });
        },
        Deprecated_DeprecatedLoginPageShellResponsiveSm = (e) => {
          let { showLogo: o, logoUrl: n, title: t, children: r, bottomChild: s, pageType: a } = e,
            l = (0, g.rZ)(),
            c = a === d.$Q.DAGWORKS,
            u = "calc(100vh - 2 * ".concat(l.spacing.lg, " - ").concat(o ? z : "0", "px)");
          return (0, i.jsx)(h.z, {
            largerThan: "sm",
            styles: { display: "none" },
            children: (0, i.jsx)(m.W, {
              p: "lg",
              size: "md",
              mih: "100vh",
              children: (0, i.jsxs)(f.K, {
                align: "center",
                justify: "center",
                mih: u,
                spacing: "lg",
                children: [
                  c && (0, i.jsx)(customer_DagworksPageTitle, {}),
                  !c && o && n && (0, i.jsx)(k.Z, { logoUrl: n }),
                  (0, i.jsxs)(v.X, {
                    variant: y.kI.Login,
                    maw: "100%",
                    miw: "100%",
                    p: "lg",
                    children: [
                      !!t &&
                        (0, i.jsx)(L.M, {
                          mt: "lg",
                          mb: "xl",
                          children: (0, i.jsx)(w.D, { order: 1, fz: "22px", fw: 600, children: t }),
                        }),
                      r,
                      s && (0, i.jsx)(L.M, { mt: "lg", children: s }),
                    ],
                  }),
                ],
              }),
            }),
          });
        },
        Responsive_LoginPageShellResponsiveMobile = (e) => {
          let { colorScheme: o, setDarkModeToggleHidden: n } = (0, c.w)(),
            t = (0, g.rZ)(),
            {
              useDeprecatedPage: r,
              maxContentWidth: s,
              showFooter: a,
              showHeader: l,
              showLogo: u,
              logoUrl: p,
              pageTitle: v,
              title: b,
              subtitle: I,
              children: E,
              bottomChild: F,
              pageType: P,
            } = e,
            D = (0, _.useRef)(null),
            z = (0, _.useRef)(null),
            { showContent: q } = hooks_useLogoOffset({
              showHeader: l,
              showLogo: u,
              logoRef: D,
              contentRef: z,
              spacing: t.spacing.lg,
            }),
            B = v === R.LOGIN_PAGE_TITLE && P === d.KZ.GOVEAGLE,
            W = P === d.$Q.DAGWORKS,
            A = t.other.loginUITheme === S.gq.Frame,
            O = t.other.loginUITheme === S.gq.SplitScreen,
            U = "calc(100vh - ".concat(l ? C.x : 0, "px)"),
            K = getConditionalRenderStyles(q),
            G = getBackgroundStyles(t, o, !0);
          return r
            ? (0, i.jsx)(Deprecated_DeprecatedLoginPageShellResponsiveSm, { ...e })
            : (0, i.jsx)(h.z, {
                largerThan: "md",
                styles: { display: "none" },
                children: (0, i.jsx)(T.x, {
                  p: 0,
                  h: "100%",
                  w: "100%",
                  style: G,
                  children: (0, i.jsx)(x.x, {
                    h: U,
                    mih: "100%",
                    w: "100%",
                    maw: "100vw",
                    onScrollPositionChange: (e) => {
                      let { y: o } = e;
                      o > 0 ? n(!0) : n(!1);
                    },
                    children: (0, i.jsx)(m.W, {
                      p: "lg",
                      h: "100%",
                      mih: U,
                      bg: O ? y.xR.LoginForegroundColor : "transparent",
                      style: { display: "flex", justifyContent: "center", alignItems: "center" },
                      children: (0, i.jsxs)(f.K, {
                        style: K,
                        ref: z,
                        align: "center",
                        justify: "center",
                        spacing: "lg",
                        w: "100%",
                        mb: a ? "xxl" : 0,
                        children: [
                          W && (0, i.jsx)(customer_DagworksPageTitle, {}),
                          !W && u && p && (0, i.jsx)(k.Z, { logoUrl: p, logoRef: D }),
                          !!b &&
                            (0, i.jsxs)(f.K, {
                              align: "center",
                              spacing: "xs",
                              my: "sm",
                              children: [
                                (0, i.jsx)(w.D, {
                                  color: O ? y.xR.LoginForegroundTextColor : y.xR.LoginBackgroundTextColor,
                                  order: 1,
                                  fz: "24px",
                                  fw: 600,
                                  children: b,
                                }),
                                !!I &&
                                  (0, i.jsx)(j.x, {
                                    color: O ? y.xR.LoginForegroundTextColor : y.xR.LoginBackgroundTextColor,
                                    size: "lg",
                                    align: "center",
                                    maw: e.maxTitleWidth,
                                    children: I,
                                  }),
                              ],
                            }),
                          (0, i.jsx)(ContentWrappers_LoginPageContentWrapperMobile, {
                            maxContentWidth: null != s ? s : Z,
                            minContentWidth: Z,
                            isFrameless: !A,
                            children: E,
                          }),
                          F && (0, i.jsx)(L.M, { w: "100%", maw: s, children: F }),
                          B &&
                            (0, i.jsx)(customer_GovEagleLoginWarning, {
                              maxContentWidth: s,
                              minContentWidth: Z,
                              isSplit: O,
                              isFrameless: !A,
                              isMobile: !0,
                            }),
                        ],
                      }),
                    }),
                  }),
                }),
              });
        },
        I = n(56817),
        E = n(17010);
      let F = (0, I.k)((e) => ({
        badge: {
          backgroundColor: "#12141D",
          padding: "".concat(e.spacing.xs, " ").concat(e.spacing.sm),
          borderRadius: e.radius.sm,
          height: "100%",
          pointerEvents: "auto",
          cursor: "pointer",
        },
        poweredBy: { color: e.colors.propelAuthGreen[6], textDecoration: "none" },
        testEnv: { color: "#bbbbbb" },
      }));
      var layout_DeprecatedFooter = (e) => {
          let { showPoweredBy: o, isTestEnv: n } = e,
            { cx: t, classes: r } = F(),
            s = (0, g.rZ)(),
            [a, l] = (0, _.useState)("");
          return (
            (0, _.useEffect)(() => {
              l(window.location.hostname || "");
            }, []),
            (0, i.jsxs)(p.Z, {
              style: { width: "100vw", height: "auto", zIndex: 10, pointerEvents: "none" },
              px: "lg",
              pb: "md",
              pos: "fixed",
              position: "apart",
              bottom: s.spacing.md,
              noWrap: !0,
              children: [
                n &&
                  (0, i.jsx)(T.x, {
                    className: t(r.badge, r.testEnv),
                    children: (0, i.jsxs)(L.M, {
                      inline: !0,
                      p: "xs",
                      children: [
                        (0, i.jsx)(E.Z, { size: s.other.iconSizes.xs }),
                        (0, i.jsx)(j.x, { size: "sm", fw: 800, ml: "sm", children: "Test Environment" }),
                      ],
                    }),
                  }),
                o &&
                  (0, i.jsx)(T.x, {
                    component: "a",
                    href: "https://www.propelauth.com?utm_campaign=poweredby&utm_source=".concat(a),
                    target: "_blank",
                    rel: "noopener noreferrer",
                    className: t(r.badge, r.poweredBy),
                    children: (0, i.jsxs)(j.x, {
                      size: "sm",
                      fw: 800,
                      p: "xs",
                      children: [
                        (0, i.jsxs)(j.x, { span: !0, style: { color: "#bbbbbb" }, children: ["Powered by", " "] }),
                        "PropelAuth",
                      ],
                    }),
                  }),
              ],
            })
          );
        },
        P = n(53658),
        D = n(94055);
      let Z = "400px",
        z = 125;
      var LoginPageShell_LoginPageShell = (e) => {
        let {
            pageConfig: o,
            pageTitle: n,
            title: t,
            subtitle: r,
            bottomChild: g,
            disableLogoOffset: u,
            showLogo: h = !0,
            pageType: p = d.$Q.DEFAULT,
            maxContentWidth: x,
            maxTitleWidth: m,
            children: f,
          } = e,
          { colorScheme: w } = (0, c.w)(),
          j = (0, l.a)("(min-width: 70em)", !0),
          L = o.use_deprecated_login_ui,
          _ = !L && o.is_test_env,
          S = o.show_powered_by,
          v = L && (S || o.is_test_env),
          y = null;
        v
          ? (y = (0, i.jsx)(layout_DeprecatedFooter, { showPoweredBy: o.show_powered_by, isTestEnv: o.is_test_env }))
          : S && (y = (0, i.jsx)(P.Z, { isDesktop: j, showNavbar: !1 }));
        let b = Responsive_LoginPageShellResponsiveDesktop;
        j || (b = Responsive_LoginPageShellResponsiveMobile);
        let k = o.has_darkmode_enabled && "dark" === w && o.darkmode_logo_url ? o.darkmode_logo_url : o.logo_url;
        return (0, i.jsxs)(s.V, {
          style: { position: "relative" },
          styles: { main: { paddingLeft: 0, paddingRight: 0, paddingBottom: 0, paddingTop: _ ? C.x : 0 } },
          header: _ ? (0, i.jsx)(a.h, { height: C.x, children: (0, i.jsx)(C.Z, {}) }) : void 0,
          children: [
            (0, i.jsx)(D.Z, { pageTitle: n, siteDisplayName: o.site_display_name }),
            (0, i.jsx)(b, {
              useDeprecatedPage: L,
              pageTitle: n,
              title: t,
              subtitle: r,
              maxContentWidth: null != x ? x : Z,
              maxTitleWidth: m,
              showLogo: h,
              showFooter: S,
              showHeader: _,
              logoUrl: k,
              bottomChild: g,
              pageType: p,
              disableLogoOffset: u,
              children: f,
            }),
            y,
          ],
        });
      };
    },
    94055: function (e, o, n) {
      var t = n(85893),
        r = n(64761),
        i = n(9008),
        s = n.n(i);
      o.Z = (e) => {
        let { pageTitle: o, siteDisplayName: n } = e,
          i = (0, r.rZ)();
        return (0, t.jsxs)(s(), {
          children: [
            (0, t.jsx)("title", { children: "".concat(o, " - ").concat(n) }),
            (0, t.jsx)("meta", { name: "description", content: "".concat(o, " - ").concat(n) }),
            (0, t.jsx)("meta", { name: "og:title", content: "".concat(o, " - ").concat(n) }),
            (0, t.jsx)("meta", { name: "og:description", content: "".concat(o, " - ").concat(n) }),
            (0, t.jsx)("meta", { name: "og:locale", content: "en_US" }),
            (0, t.jsx)("meta", { name: "og:type", content: "website" }),
            (0, t.jsx)("meta", { name: "theme-color", content: i.colors.mainBackgroundColor[6] }),
            (0, t.jsx)("link", { rel: "icon", href: "/api/fe/v1/favicon.ico" }),
          ],
        });
      };
    },
    94806: function (e, o, n) {
      var t = n(85893),
        r = n(64761),
        i = n(58036),
        s = n(64523),
        a = n(54777),
        l = n(95117),
        c = n(54070),
        d = n(95427);
      o.Z = (e) => {
        let { isFrameless: o = !1, showDivider: n = !0, useDeprecatedStyle: g = !1 } = e,
          u = (0, r.rZ)();
        return (0, t.jsx)(i.u, {
          mounted: n || g,
          transition: "fade",
          duration: 0,
          children: (e) =>
            (0, t.jsx)(s.x, {
              styles: e,
              children: (0, t.jsx)(a.i, {
                my: "xl",
                color: (0, d.tv)(u, o ? c.kI.LoginFrameless : c.kI.Login),
                label: (0, t.jsx)(l.x, {
                  size: "lg",
                  mx: "md",
                  color: g
                    ? (0, d.tv)(u, o ? c.kI.LoginFrameless : c.kI.Login)
                    : u.fn.rgba(u.colors[o ? c.xR.LoginBackgroundTextColor : c.xR.LoginForegroundTextColor][6], 0.5),
                  children: "OR",
                }),
                labelPosition: "center",
              }),
            }),
        });
      };
    },
    16393: function (e, o, n) {
      var t = n(85893),
        r = n(66137),
        i = n(95117),
        s = n(54685),
        a = n(41664),
        l = n.n(a),
        c = n(40423),
        d = n(54070);
      o.Z = (e) => {
        var o;
        let { theme: n } = e,
          a = n.login_ui_theme === c.gq.SplitScreen,
          g = a ? d.kI.Login : d.kI.LoginFrameless,
          u = a ? d.xR.LoginForegroundTextColor : d.xR.LoginBackgroundTextColor,
          h = null === (o = n.helplink) || void 0 === o ? void 0 : o.enabled;
        return n.helplink && h
          ? (0, t.jsxs)(r.Z, {
              noWrap: !0,
              position: "center",
              w: "100%",
              children: [
                n.helplink.text && (0, t.jsx)(i.x, { color: u, size: "lg", children: "".concat(n.helplink.text, " ") }),
                (0, t.jsx)(s.e, {
                  tabIndex: -1,
                  component: l(),
                  href: n.helplink.url,
                  fw: 500,
                  size: "lg",
                  variant: g,
                  children: n.helplink.url_text,
                }),
              ],
            })
          : null;
      };
    },
    69432: function (e, o, n) {
      var t = n(85893);
      o.Z = (e) => {
        let { logoUrl: o, logoRef: n, maxHeight: r, maxWidth: i } = e;
        return (0, t.jsx)("img", {
          ref: n,
          src: o,
          alt: "Logo",
          crossOrigin: "anonymous",
          style: {
            width: "auto",
            maxWidth: null != i ? i : "350px",
            height: "auto",
            maxHeight: null != r ? r : "125px",
          },
        });
      };
    },
    67456: function (e, o, n) {
      var t = n(85893),
        r = n(19236),
        i = n(95117),
        s = n(97564),
        a = n(67841),
        l = n(11163),
        c = n(54070);
      o.Z = (e) => {
        let { setStopRedirecting: o } = e,
          n = (0, l.useRouter)();
        return (0, t.jsxs)(t.Fragment, {
          children: [
            (0, t.jsx)(r.D, {
              fz: "lg",
              order: 2,
              color: "".concat(c.xR.ErrorButtonColor, ".6"),
              children: "You appear to be using a browser that does not support third-party cookies.",
            }),
            (0, t.jsx)(i.x, {
              mt: "lg",
              children:
                "Google Chrome is currently the only browser that supports third-party cookies by default. If you are using your application in a test environment, you will need to use Google Chrome while not in Incognito Mode, or otherwise enable third-party cookies in your browser. This only affects the test environment, not production. We apologize for the inconvenience, and are working on a fix for this issue.",
            }),
            (0, t.jsxs)(s.K, {
              mt: "lg",
              children: [
                (0, t.jsx)(a.z, {
                  variant: c.Bq.LoginPrimary,
                  fullWidth: !0,
                  onClick: () => n.push("https://docs.propelauth.com/overview/faq"),
                  children: "Learn More",
                }),
                (0, t.jsx)(a.z, {
                  fullWidth: !0,
                  variant: c.Bq.LoginOutline,
                  onClick: () => {
                    (localStorage.setItem("redirectTimerStart", "0"),
                      localStorage.setItem("redirectAttempts", "0"),
                      o(!1));
                  },
                  children: "Retry",
                }),
              ],
            }),
          ],
        });
      };
    },
    33614: function (e, o, n) {
      var t,
        r,
        i = n(85893),
        s = n(64761),
        a = n(58036),
        l = n(97564),
        c = n(4528),
        d = n(54827),
        g = n(35336),
        u = n(11163),
        h = n(40423),
        p = n(54070),
        x = n(95427),
        m = n(53395),
        f = n(92916),
        w = n(25695);
      (((t = r || (r = {})).Google = "/google/login"),
        (t.Github = "/github/login"),
        (t.Slack = "/slack/login"),
        (t.Microsoft = "/microsoft/login"),
        (t.LinkedIn = "/linkedin/login"),
        (t.Outreach = "/outreach/login"),
        (t.Xero = "/xero/login"),
        (t.QuickBooks = "/quickbooks/login"),
        (t.Salesforce = "/salesforce/login"),
        (t.Salesloft = "/salesloft/login"),
        (t.Atlassian = "/atlassian/login"),
        (t.Apple = "/apple/login"),
        (t.GitLab = "/gitlab/login"),
        (o.Z = (e) => {
          let { pageConfig: o, pageType: n, useDeprecatedPage: t = !1, signup: r = !1, showSignInOptions: j = !0 } = e,
            L = (0, u.useRouter)(),
            _ = (0, s.rZ)(),
            handleSocialLogin = async (e) => {
              await L.push(e);
            },
            handlePasswordlessLogin = async () => {
              o.has_passwordless_login && (await L.push({ pathname: "/login_passwordless", query: { ...L.query } }));
            },
            handlePhoneLogin = async () => {
              k && (await L.push("/login_phone"));
            },
            handleSsoLogin = async () => {
              o.has_sso_login && (await L.push({ pathname: "/login_sso", query: { ...L.query } }));
            },
            S = r ? "Sign up" : "Sign in",
            v = o.has_otp_login ? "code" : "Magic Link",
            y = o.theme.login_ui_theme === h.gq.Frameless,
            b = !t && y ? p.Bq.LoginFramelessOutline : p.Bq.LoginOutline,
            k = n === m.KZ.BUILDWITT,
            {
              has_github_login: C,
              has_linkedin_login: R,
              has_google_login: T,
              has_microsoft_login: I,
              has_slack_login: E,
              has_outreach_login: F,
              has_xero_login: P,
              has_quickbooks_login: D,
              has_salesforce_login: Z,
              has_salesloft_login: z,
              has_atlassian_login: q,
              has_apple_login: B,
              has_gitlab_login: W,
              has_passwordless_login: A,
              has_otp_login: O,
              has_sso_login: U,
              default_to_saml_login: K,
              use_org_name_for_saml: G,
            } = o,
            M = U && (!K || G || r || t),
            N = A && (!r || !O),
            H = (0, x.dq)(_, b),
            V = "transparent" === H ? (0, f._T)((0, f.wX)(_, p.xR.LoginForegroundColor)) : (0, f._T)(H);
          return (0, i.jsx)(a.u, {
            mounted: j || t,
            transition: "fade",
            duration: 0,
            children: (e) =>
              (0, i.jsxs)(l.K, {
                styles: e,
                spacing: "md",
                children: [
                  T &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: "/img/g-logo.svg",
                      pos: "relative",
                      variant: b,
                      onClick: () => handleSocialLogin("/google/login"),
                      children: "".concat(S, " with Google"),
                    }),
                  C &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: V ? "/img/github-logo-light.svg" : "/img/github-logo.svg",
                      variant: b,
                      onClick: () => handleSocialLogin("/github/login"),
                      children: "".concat(S, " with GitHub"),
                    }),
                  E &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: "/img/slack-logo.svg",
                      variant: b,
                      onClick: () => handleSocialLogin("/slack/login"),
                      children: "".concat(S, " with Slack"),
                    }),
                  I &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: "/img/microsoft-logo.svg",
                      variant: b,
                      onClick: () => handleSocialLogin("/microsoft/login"),
                      children: "".concat(S, " with Microsoft"),
                    }),
                  R &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: "/img/linkedin-logo.svg",
                      variant: b,
                      onClick: () => handleSocialLogin("/linkedin/login"),
                      children: "".concat(S, " with LinkedIn"),
                    }),
                  F &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: "/img/outreach-logo.svg",
                      variant: b,
                      onClick: () => handleSocialLogin("/outreach/login"),
                      children: "".concat(S, " with Outreach"),
                    }),
                  P &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: "/img/xero-logo.svg",
                      variant: b,
                      onClick: () => handleSocialLogin("/xero/login"),
                      children: "".concat(S, " with Xero"),
                    }),
                  D &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: "/img/quickbooks-logo.svg",
                      variant: b,
                      onClick: () => handleSocialLogin("/quickbooks/login"),
                      children: "".concat(S, " with QuickBooks"),
                    }),
                  Z &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: "/img/salesforce-logo.svg",
                      variant: b,
                      onClick: () => handleSocialLogin("/salesforce/login"),
                      children: "".concat(S, " with Salesforce"),
                    }),
                  z &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: "/img/salesloft-logo.svg",
                      variant: b,
                      onClick: () => handleSocialLogin("/salesloft/login"),
                      children: "".concat(S, " with Salesloft"),
                    }),
                  q &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: "/img/atlassian-logo.svg",
                      variant: b,
                      onClick: () => handleSocialLogin("/atlassian/login"),
                      children: "".concat(S, " with Atlassian Cloud"),
                    }),
                  B &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: "/img/apple-logo.svg",
                      variant: b,
                      onClick: () => handleSocialLogin("/apple/login"),
                      children: "".concat(S, " with Apple"),
                    }),
                  W &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: "/img/gitlab-logo.svg",
                      variant: b,
                      onClick: () => handleSocialLogin("/gitlab/login"),
                      children: "".concat(S, " with GitLab"),
                    }),
                  N &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: (0, i.jsx)(c.Z, { size: _.other.iconSizes.lg }),
                      variant: b,
                      onClick: handlePasswordlessLogin,
                      children: "".concat(S, " with ").concat(v),
                    }),
                  k &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: (0, i.jsx)(d.Z, { size: _.other.iconSizes.lg }),
                      variant: b,
                      onClick: handlePhoneLogin,
                      children: "".concat(S, " with Phone Number"),
                    }),
                  M &&
                    (0, i.jsx)(w.Z, {
                      farLeftIcon: (0, i.jsx)(g.Z, { size: _.other.iconSizes.lg }),
                      variant: b,
                      onClick: handleSsoLogin,
                      children: "".concat(S, " with SSO"),
                    }),
                ],
              }),
          });
        }));
    },
    87325: function (e, o, n) {
      var t = n(85893),
        r = n(97564),
        i = n(58036),
        s = n(80061),
        a = n(66137),
        l = n(95117),
        c = n(31003),
        d = n(73193),
        g = n(54685),
        u = n(67841),
        h = n(20966),
        p = n(77248),
        x = n(33575),
        m = n(41664),
        f = n.n(m),
        w = n(11163),
        j = n(67294),
        L = n(1448),
        _ = n(50508),
        S = n(70781),
        v = n(99748),
        y = n(42455),
        b = n(54070),
        k = n(95427);
      o.Z = (e) => {
        let {
            isFrameless: o,
            useDeprecatedPage: n = !1,
            defaultToSamlLogin: m,
            hasPasswordLogin: C,
            showPasswordLogin: R,
            gatePasswordLogin: T,
            setLoginComponentVisibility: I,
            loginButtonTextOverride: E,
          } = e,
          { classes: F } = (0, k.fc)(),
          P = (0, w.useRouter)(),
          { setFocus: D, focusProps: Z } = (0, y.K)(!1, "passwordInput", !0),
          { posthogClient: z } = (0, S.r)(),
          [q, B] = (0, j.useState)(!1),
          [W, A] = (0, j.useState)(""),
          O = (0, p.c)({
            initialValues: { username: "", password: "" },
            validate: {
              username: (e) => {
                if (m) {
                  if (!e) return "Username is required";
                  if (e.length > 32) return "Username cannot be longer than 32 characters";
                }
                return null;
              },
            },
          }),
          U = o ? b.kI.LoginFrameless : b.kI.Login,
          K = R && T,
          handleSubmit = async (e) => {
            let o = !R && T && !n;
            if (o) {
              I(v.LoginComponentVisibility.Password);
              return;
            }
            (B(!0), O.resetTouched());
            let t = await (0, _.V)({ emailOrUsername: e.username, password: e.password, useUsernameOverEmail: !0 });
            if (t.success) {
              let { user_id: e } = t.data;
              (z && z.identify(e), await P.push("/post_login"));
            } else
              ("bad_request" === t.error_type
                ? (O.setErrors(t.field_to_errors), t.overall_errors && A(t.overall_errors[0]))
                : "login_not_found" === t.error_type
                  ? (O.setFieldError("username", !0), O.setFieldError("password", !0), A(t.message))
                  : x.N9.show({ title: "Error", message: L.aK, color: b.xR.ErrorButtonColor, classNames: F }),
                B(!1));
          };
        return (
          (0, j.useEffect)(() => {
            O.isTouched() && W && (A(""), O.clearErrors());
          }, [O, W]),
          (0, t.jsx)("form", {
            onSubmit: O.onSubmit(handleSubmit),
            children: (0, t.jsxs)(r.K, {
              children: [
                (0, t.jsx)(i.u, {
                  mounted: R,
                  transition: "fade",
                  duration: 0,
                  children: (e) =>
                    (0, t.jsxs)(r.K, {
                      styles: e,
                      spacing: "lg",
                      children: [
                        (0, t.jsx)(s.o, {
                          variant: U,
                          label: (0, t.jsx)(a.Z, {
                            position: "apart",
                            noWrap: !0,
                            children: (0, t.jsx)(l.x, { children: "Username" }),
                          }),
                          autoComplete: "username",
                          autoCapitalize: "off",
                          ...O.getInputProps("username"),
                        }),
                        (0, t.jsx)(c.U, {
                          in: C,
                          transitionTimingFunction: "ease-in-out",
                          onTransitionEnd: () => D(!0),
                          children: (0, t.jsx)(d.W, {
                            autoComplete: "current-password",
                            variant: U,
                            label: (0, t.jsxs)(a.Z, {
                              noWrap: !0,
                              position: "apart",
                              w: "100%",
                              p: 0,
                              children: [
                                (0, t.jsx)(l.x, { children: "Password" }),
                                (0, t.jsx)(g.e, {
                                  tabIndex: 3,
                                  component: f(),
                                  href: { pathname: "/forgot_password", query: { ...P.query } },
                                  variant: U,
                                  onMouseDown: (e) => e.preventDefault(),
                                  children: "Forgot password?",
                                }),
                              ],
                            }),
                            ...O.getInputProps("password"),
                            ...(m ? Z : {}),
                          }),
                        }),
                        W && (0, t.jsx)(l.x, { color: b.xR.ErrorButtonColor, children: W }),
                      ],
                    }),
                }),
                (0, t.jsxs)(r.K, {
                  mt: R ? "lg" : "sm",
                  children: [
                    (0, t.jsx)(u.z, {
                      variant: b.Bq.LoginPrimary,
                      type: "submit",
                      fullWidth: !0,
                      disabled: q,
                      children: q
                        ? (0, t.jsx)(h.a, { color: b.xR.LoginSuccessButtonColor, size: "sm" })
                        : E || "Log in with username",
                    }),
                    K &&
                      (0, t.jsx)(u.z, {
                        onClick: () => I(v.LoginComponentVisibility.SignIn),
                        variant: b.Bq.LoginSubtlePrimary,
                        fullWidth: !0,
                        disabled: q,
                        children: "Other login methods",
                      }),
                  ],
                }),
              ],
            }),
          })
        );
      };
    },
    25695: function (e, o, n) {
      var t = n(85893),
        r = n(64761),
        i = n(67841),
        s = n(66137);
      o.Z = (e) => {
        let { farLeftIcon: o, children: n, ...a } = e,
          l = (0, r.rZ)();
        return (0, t.jsxs)(i.z, {
          pos: "relative",
          ...a,
          children: [
            (0, t.jsx)(s.Z, {
              pos: "absolute",
              left: 16,
              children:
                "string" == typeof o
                  ? (0, t.jsx)("img", {
                      src: o,
                      alt: "Identity Provider logo",
                      style: { height: l.other.iconSizes.lg, width: l.other.iconSizes.lg },
                    })
                  : o,
            }),
            n,
          ],
        });
      };
    },
    99748: function (e, o, n) {
      (n.r(o),
        n.d(o, {
          LOGIN_PAGE_TITLE: function () {
            return G;
          },
          LoginComponentVisibility: function () {
            return s;
          },
          LoginState: function () {
            return i;
          },
          __N_SSP: function () {
            return K;
          },
          default: function () {
            return en_login;
          },
        }));
      var t,
        r,
        i,
        s,
        a = n(85893),
        l = n(97564),
        c = n(95117),
        d = n(34065),
        g = n(67294),
        u = n(40423),
        h = n(31908),
        p = n(54070),
        x = n(53395),
        m = n(66137),
        f = n(67841),
        w = n(11163),
        j = n(48552),
        Deprecated_DeprecatedDefaultLoginShellFooter = (e) => {
          let { showSignupButton: o, renderPasswordLogin: n, isSmallMobile: t } = e,
            r = (0, w.useRouter)(),
            { isPageEnabled: i } = (0, j.z)(),
            s = i(u.Aj.Signup);
          return (0, a.jsxs)(m.Z, {
            noWrap: !0,
            position: o && n && s ? "apart" : "center",
            w: "100%",
            children: [
              o &&
                s &&
                (0, a.jsx)(f.z, {
                  onClick: () => r.push("/signup"),
                  variant: p.Bq.TextOld,
                  p: 0,
                  children: (0, a.jsx)(c.x, { size: t ? "md" : "lg", children: "No account? Sign up" }),
                }),
              n &&
                (0, a.jsx)(f.z, {
                  onClick: () => r.push("/forgot_password"),
                  variant: p.Bq.TextOld,
                  p: 0,
                  children: (0, a.jsx)(c.x, { size: t ? "md" : "lg", children: "Forgot password?" }),
                }),
            ],
          });
        },
        DeprecatedLetterLoginShellFooter = (e) => {
          let { isSmallMobile: o } = e,
            n = (0, w.useRouter)();
          return (0, a.jsxs)(l.K, {
            w: "100%",
            spacing: "xs",
            children: [
              (0, a.jsx)(f.z, {
                onClick: () => n.push("/forgot_password"),
                variant: p.Bq.TextOld,
                p: 0,
                children: (0, a.jsx)(c.x, { size: o ? "md" : "lg", children: "Forgot password?" }),
              }),
              (0, a.jsxs)(m.Z, {
                noWrap: !0,
                position: "center",
                w: "100%",
                children: [
                  (0, a.jsx)(c.x, { size: o ? "md" : "lg", children: "Not a user?" }),
                  (0, a.jsx)(f.z, {
                    onClick: () => {
                      window.location.href = "https://www.letter.ai/request-a-demo";
                    },
                    variant: p.Bq.TextOld,
                    p: 0,
                    children: (0, a.jsx)(c.x, { size: o ? "md" : "lg", children: "Request access" }),
                  }),
                ],
              }),
            ],
          });
        },
        L = n(58036),
        _ = n(80061),
        S = n(54685),
        v = n(31003),
        y = n(73193),
        b = n(20966),
        k = n(77248),
        C = n(59417),
        R = n(33575),
        T = n(41664),
        I = n.n(T),
        E = n(79180),
        F = n(1448),
        P = n(50508),
        D = n(70781),
        Z = n(42455),
        z = n(95427),
        Deprecated_DeprecatedPasswordLogin = (e) => {
          let { form: o, globalError: n, areButtonsDisabled: t, isLoading: r, handleSubmit: i } = e;
          return (0, a.jsx)("form", {
            onSubmit: o.onSubmit(i),
            children: (0, a.jsxs)(l.K, {
              mt: "lg",
              children: [
                (0, a.jsx)(_.o, {
                  variant: p.kI.Login,
                  placeholder: "Email",
                  autoComplete: "email",
                  ...o.getInputProps("email"),
                }),
                (0, a.jsx)(_.o, {
                  autoComplete: "current-password",
                  variant: p.kI.Login,
                  placeholder: "Password",
                  type: "password",
                  ...o.getInputProps("password"),
                }),
                n && (0, a.jsx)(c.x, { color: p.xR.ErrorButtonColor, children: n }),
                (0, a.jsx)(f.z, {
                  variant: p.Bq.LoginPrimary,
                  mt: "lg",
                  type: "submit",
                  fullWidth: !0,
                  disabled: t,
                  children: r ? (0, a.jsx)(b.a, { color: p.xR.LoginSuccessButtonColor, size: "sm" }) : "Log In",
                }),
              ],
            }),
          });
        },
        login_EmailLogin = (e) => {
          let {
              orgsMetaname: o,
              isFrameless: n,
              useDeprecatedPage: t = !1,
              defaultToSamlLogin: r,
              hasPasswordLogin: i,
              showPasswordLogin: d,
              gatePasswordLogin: u,
              setLoginComponentVisibility: h,
              providedEmail: x,
              loginButtonTextOverride: j,
            } = e,
            { classes: T } = (0, z.fc)(),
            q = (0, w.useRouter)(),
            { setFocus: B, focusProps: W } = (0, Z.K)(!1, "passwordInput", !0),
            { posthogClient: A } = (0, D.r)(),
            [O, U] = (0, g.useState)(!1),
            [K, G] = (0, g.useState)(!1),
            [M, N] = (0, g.useState)(""),
            [H, V] = (0, C.G)("", 500),
            [X, Q] = (0, g.useState)(""),
            [$, J] = (0, g.useState)(!1),
            [Y, ee] = (0, g.useState)(!1),
            eo = (0, k.c)({
              initialValues: { email: null != x ? x : "", org_name: "", password: "" },
              validate: {
                email: (e) => {
                  let o = e.trim();
                  if (r && !$) {
                    if (!o) return "Email is required";
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o)) return "Email is invalid";
                  }
                  return null;
                },
                org_name: (e) => {
                  let o = e.trim();
                  return r && $ && !o ? "This field is required" : null;
                },
              },
              transformValues: (e) => ({ ...e, email: e.email.trim(), org_name: e.org_name.trim() }),
            }),
            en = n ? p.kI.LoginFrameless : p.kI.Login,
            et = d && u,
            er = !r || K,
            handleSubmit = async (e) => {
              if (O) return;
              let o = !d && u && !t;
              if (o) {
                h(s.Password);
                return;
              }
              let n = !K && r && !t;
              if (n) {
                U(!0);
                let o = $ ? { org_name: e.org_name } : { email: e.email },
                  n = await (0, E.X)(o);
                if (n.success) {
                  q.push(n.data.login_url);
                  return;
                }
                if ("ambiguous_results" !== n.error_type || $) {
                  (U(!1), $ ? (G(!0), ee(!0), J(!1)) : i ? G(!0) : eo.setFieldError("email", ei));
                  return;
                }
                (U(!1), J(!0));
                return;
              }
              (U(!0), eo.resetTouched());
              let a = await (0, P.V)({ emailOrUsername: e.email, password: e.password, useUsernameOverEmail: !1 });
              if (a.success) {
                let { user_id: e } = a.data;
                (A && A.identify(e), await q.push("/post_login"));
              } else
                ("bad_request" === a.error_type
                  ? (eo.setErrors(a.field_to_errors), a.overall_errors && Q(a.overall_errors[0]))
                  : "login_not_found" === a.error_type
                    ? (eo.setFieldError("email", !0), eo.setFieldError("password", !0), Q(a.message))
                    : R.N9.show({ title: "Error", message: F.aK, color: p.xR.ErrorButtonColor, classNames: T }),
                  U(!1));
            };
          ((0, g.useEffect)(() => {
            eo.isTouched() && X && (Q(""), eo.clearErrors());
          }, [eo, X]),
            (0, g.useEffect)(() => {
              let e = H && r && K && i && !$ && !Y,
                checkForSaml = async () => {
                  let e = await (0, E.X)({ email: H });
                  e.success ? N(e.data.login_url) : N("");
                };
              e && checkForSaml();
            }, [H, r, i, K, $, Y]));
          let ei = "No ".concat(o.toLowerCase(), " found for that domain"),
            onEmailChange = (e) => {
              (eo.getInputProps("email").onChange(e), K && (N(""), V(e.target.value)));
            };
          return t
            ? (0, a.jsx)(Deprecated_DeprecatedPasswordLogin, {
                form: eo,
                globalError: X,
                areButtonsDisabled: O,
                isLoading: O,
                handleSubmit: handleSubmit,
              })
            : (0, a.jsx)("form", {
                onSubmit: eo.onSubmit(handleSubmit),
                children: (0, a.jsxs)(l.K, {
                  children: [
                    (0, a.jsx)(L.u, {
                      mounted: d,
                      transition: "fade",
                      duration: 0,
                      children: (e) =>
                        (0, a.jsxs)(l.K, {
                          styles: e,
                          spacing: "lg",
                          children: [
                            $ &&
                              (0, a.jsx)(c.x, {
                                children: "We were unable to automatically determine the "
                                  .concat(o.toLocaleLowerCase(), " you're looking for. What ")
                                  .concat(o.toLowerCase(), " are you signing in with?"),
                              }),
                            $
                              ? (0, a.jsx)(_.o, {
                                  variant: en,
                                  label: "".concat(o, " Name"),
                                  ...eo.getInputProps("org_name"),
                                })
                              : (0, a.jsx)(_.o, {
                                  variant: en,
                                  label: (0, a.jsxs)(m.Z, {
                                    position: "apart",
                                    noWrap: !0,
                                    children: [
                                      (0, a.jsx)(c.x, { children: $ ? "".concat(o, " Name") : "Email" }),
                                      (0, a.jsx)(S.e, {
                                        tabIndex: M ? 2 : -1,
                                        component: I(),
                                        href: M,
                                        variant: en,
                                        style: {
                                          transition: "opacity 0.1s ease-in-out",
                                          opacity: M ? 1 : 0,
                                          pointerEvents: M ? "auto" : "none",
                                        },
                                        onMouseDown: (e) => e.preventDefault(),
                                        children: "Sign in with SSO",
                                      }),
                                    ],
                                  }),
                                  autoComplete: "email",
                                  ...eo.getInputProps("email"),
                                  onChange: onEmailChange,
                                }),
                            (0, a.jsx)(v.U, {
                              in: er && i,
                              transitionTimingFunction: "ease-in-out",
                              onTransitionEnd: () => B(!0),
                              children: (0, a.jsx)(y.W, {
                                hidden: !er || !d,
                                autoComplete: "current-password",
                                variant: en,
                                label: (0, a.jsxs)(m.Z, {
                                  noWrap: !0,
                                  position: "apart",
                                  w: "100%",
                                  p: 0,
                                  children: [
                                    (0, a.jsx)(c.x, { children: "Password" }),
                                    (0, a.jsx)(S.e, {
                                      tabIndex: 3,
                                      component: I(),
                                      href: { pathname: "/forgot_password", query: { ...q.query } },
                                      variant: en,
                                      onMouseDown: (e) => e.preventDefault(),
                                      children: "Forgot password?",
                                    }),
                                  ],
                                }),
                                ...eo.getInputProps("password"),
                                ...(r && $ ? W : {}),
                              }),
                            }),
                            X && (0, a.jsx)(c.x, { color: p.xR.ErrorButtonColor, children: X }),
                          ],
                        }),
                    }),
                    (0, a.jsxs)(l.K, {
                      mt: d ? "lg" : "sm",
                      children: [
                        (0, a.jsx)(f.z, {
                          variant: p.Bq.LoginPrimary,
                          type: "submit",
                          fullWidth: !0,
                          disabled: O,
                          children: O
                            ? (0, a.jsx)(b.a, { color: p.xR.LoginSuccessButtonColor, size: "sm" })
                            : er && j
                              ? j
                              : er
                                ? "Log in with email"
                                : "Continue",
                        }),
                        $ &&
                          !Y &&
                          (0, a.jsx)(f.z, {
                            variant: p.Bq.LoginOutline,
                            fullWidth: !0,
                            disabled: O || O,
                            onClick: () => {
                              (eo.setFieldValue("email", ""), eo.setFieldError("email", null), J(!1), G(!0), ee(!0));
                            },
                            children: "Log in with password",
                          }),
                        et &&
                          (0, a.jsx)(f.z, {
                            onClick: () => h(s.SignIn),
                            variant: p.Bq.LoginSubtlePrimary,
                            fullWidth: !0,
                            disabled: O,
                            children: "Other login methods",
                          }),
                      ],
                    }),
                  ],
                }),
              });
        },
        q = n(94806),
        B = n(67456),
        W = n(33614),
        Deprecated_DeprecatedLoginPage = (e) => {
          let { pageConfig: o, pageType: n, isSmallMobile: t, stopRedirecting: r, setStopRedirecting: i } = e,
            s = r && o.is_test_env,
            l = (o.has_any_social_login || o.has_passwordless_login || o.has_sso_login) && !s,
            d = o.has_password_login && !s,
            g = !s && !l && !d,
            u = !s && !g,
            m = o.allow_public_signups;
          return (0, a.jsxs)(h.ZP, {
            pageConfig: o,
            pageTitle: "Login",
            title: u ? "Welcome" : "",
            showLogo: u,
            bottomChild:
              u && (m || d)
                ? n === x.KZ.LETTER
                  ? (0, a.jsx)(DeprecatedLetterLoginShellFooter, { isSmallMobile: t })
                  : (0, a.jsx)(Deprecated_DeprecatedDefaultLoginShellFooter, {
                      renderPasswordLogin: d,
                      showSignupButton: m,
                      isSmallMobile: t,
                    })
                : void 0,
            children: [
              g &&
                (0, a.jsx)(c.x, {
                  color: p.xR.ErrorButtonColor,
                  align: "center",
                  children: "There are no login options enabled. Contact your administrator to set one up.",
                }),
              s && (0, a.jsx)(B.Z, { setStopRedirecting: i }),
              l && (0, a.jsx)(W.Z, { useDeprecatedPage: !0, pageConfig: o }),
              l && d && !s && (0, a.jsx)(q.Z, { useDeprecatedStyle: !0 }),
              d &&
                (0, a.jsx)(login_EmailLogin, {
                  hasPasswordLogin: !0,
                  defaultToSamlLogin: !1,
                  orgsMetaname: "",
                  showPasswordLogin: !0,
                  gatePasswordLogin: !1,
                  setLoginComponentVisibility: (e) => {},
                  isFrameless: !1,
                  useDeprecatedPage: !0,
                }),
            ],
          });
        },
        LoginFooters_DefaultLoginShellFooter = (e) => {
          let { showSignupButton: o, loginUITheme: n } = e,
            t = n === u.gq.SplitScreen,
            r = t ? p.kI.Login : p.kI.LoginFrameless,
            i = t ? p.xR.LoginForegroundTextColor : p.xR.LoginBackgroundTextColor,
            s = (0, w.useRouter)(),
            { isPageEnabled: l } = (0, j.z)();
          return o && l(u.Aj.Signup)
            ? (0, a.jsxs)(m.Z, {
                noWrap: !0,
                position: "center",
                w: "100%",
                children: [
                  (0, a.jsx)(c.x, { color: i, size: "lg", children: "Don't have an account? " }),
                  (0, a.jsx)(S.e, {
                    tabIndex: -1,
                    component: I(),
                    href: { pathname: "/signup", query: { ...s.query } },
                    fw: 500,
                    size: "lg",
                    variant: r,
                    children: "Sign up",
                  }),
                ],
              })
            : null;
        },
        A = n(16393),
        LoginFooters_LetterLoginShellFooter = (e) => {
          let { loginUITheme: o } = e,
            n = o === u.gq.SplitScreen,
            t = n ? p.kI.Login : p.kI.LoginFrameless,
            r = n ? p.xR.LoginForegroundTextColor : p.xR.LoginBackgroundTextColor;
          return (0, a.jsxs)(m.Z, {
            noWrap: !0,
            position: "center",
            w: "100%",
            children: [
              (0, a.jsx)(c.x, { color: r, size: "lg", children: "Not a user?" }),
              (0, a.jsx)(S.e, {
                tabIndex: 2,
                component: I(),
                href: "https://www.letter.ai/request-a-demo",
                variant: t,
                fw: 500,
                size: "lg",
                children: (0, a.jsx)(c.x, { color: r, size: "lg", children: "Request access" }),
              }),
            ],
          });
        },
        LoginFooters_QuanLoginShellFooter = (e) => {
          let { loginUITheme: o } = e,
            n = o === u.gq.SplitScreen,
            t = n ? p.kI.Login : p.kI.LoginFrameless,
            r = n ? p.xR.LoginForegroundTextColor : p.xR.LoginBackgroundTextColor;
          return (0, a.jsxs)(m.Z, {
            noWrap: !0,
            position: "center",
            w: "100%",
            children: [
              (0, a.jsx)(c.x, { color: r, size: "lg", children: "Having trouble logging in?" }),
              (0, a.jsx)(S.e, {
                tabIndex: 2,
                component: I(),
                href: "https://www.quanwellbeing.com/contact",
                variant: t,
                fw: 500,
                size: "lg",
                children: "Contact us",
              }),
            ],
          });
        },
        O = n(87325),
        U = n(73758),
        K = !0;
      let G = "Login";
      (((t = i || (i = {})).LoginRequired = "LoginRequired"),
        (t.TwoFactorRequired = "TwoFactorRequired"),
        (t.ConfirmEmailRequired = "ConfirmEmailRequired"),
        (t.UserMetadataRequired = "UserMetadataRequired"),
        (t.OrgCreationRequired = "OrgCreationRequired"),
        (t.UpdatePasswordRequired = "UpdatePasswordRequired"),
        (t.TwoFactorEnablementRequired = "TwoFactorEnablementRequired"),
        (t.SamlLoginRequired = "SamlLoginRequired"),
        (t.Finished = "Finished"),
        ((r = s || (s = {})).Full = "full"),
        (r.SignIn = "sign_in"),
        (r.Password = "password"));
      var en_login = (e) => {
        var o;
        let n;
        let { pageConfig: t, pageType: r, base64Email: i } = e,
          s = (0, d.a)("(max-width: 24em)", !1),
          [m, f] = (0, g.useState)(!1);
        (0, g.useEffect)(() => {
          let e = parseInt(localStorage.getItem("redirectAttempts") || "0"),
            o = parseInt(localStorage.getItem("redirectTimerStart") || "0");
          ((0 === e || 0 === o) && ((o = Date.now()), localStorage.setItem("redirectTimerStart", o.toString())),
            e >= 10 && Date.now() - o <= 3e3
              ? f(!0)
              : Date.now() - o > 3e3
                ? (f(!1), localStorage.setItem("redirectAttempts", "0"))
                : localStorage.setItem("redirectAttempts", (e + 1).toString()));
        }, []);
        let w = r === x.KZ.BUILDWITT,
          j = t.use_deprecated_login_ui,
          L = t.theme.login_ui_theme === u.gq.Frameless,
          _ = t.theme.display_project_name,
          S = m && t.is_test_env,
          v = t.has_sso_login && (!t.default_to_saml_login || t.use_org_name_for_saml),
          y = (w || t.has_any_social_login || t.has_passwordless_login || v) && !S,
          b = t.has_sso_login && t.default_to_saml_login && !t.use_org_name_for_saml && !S,
          k = t.has_password_login && !S,
          C = (null === (o = t.customer_overrides) || void 0 === o ? void 0 : o.use_username_login_over_email) || !1,
          R = (k || b) && !C,
          T = k && C,
          I = !S && !y && !k,
          E = !S && !I,
          F = t.allow_public_signups && r !== x.KZ.DREAMDATA,
          P = t.theme.helplink && t.theme.helplink.enabled,
          D = r === x.KZ.SCRIBBLEVET ? "Sign in" : "Log in",
          {
            has_github_login: Z,
            has_linkedin_login: z,
            has_google_login: K,
            has_microsoft_login: M,
            has_slack_login: N,
            has_quickbooks_login: H,
            has_xero_login: V,
            has_salesforce_login: X,
            has_atlassian_login: Q,
            has_apple_login: $,
          } = t,
          J = [Z, z, K, M, N, H, V, X, Q, $].filter((e) => e).length,
          Y = J > 2 && !b,
          [ee, eo] = (0, g.useState)(Y ? "sign_in" : "full"),
          en = "password" !== ee,
          et = "sign_in" !== ee,
          er = i ? (0, U.TI)(i) : void 0;
        r === x.KZ.SCRIBBLEVET && (n = "Sign in with password");
        let ei = y && (0, a.jsx)(W.Z, { pageType: r, showSignInOptions: en, pageConfig: t }),
          es = R
            ? (0, a.jsx)(login_EmailLogin, {
                orgsMetaname: t.orgs_metaname,
                hasPasswordLogin: k,
                gatePasswordLogin: Y,
                showPasswordLogin: et,
                defaultToSamlLogin: b,
                setLoginComponentVisibility: eo,
                isFrameless: L,
                providedEmail: er,
                loginButtonTextOverride: n,
              })
            : T &&
              (0, a.jsx)(O.Z, {
                orgsMetaname: t.orgs_metaname,
                hasPasswordLogin: k,
                gatePasswordLogin: Y,
                showPasswordLogin: et,
                defaultToSamlLogin: b,
                setLoginComponentVisibility: eo,
                isFrameless: L,
                loginButtonTextOverride: n,
              });
        if (b) {
          let e = es;
          ((es = ei), (ei = e));
        }
        return j
          ? (0, a.jsx)(Deprecated_DeprecatedLoginPage, {
              isSmallMobile: s,
              pageConfig: t,
              pageType: r,
              stopRedirecting: m,
              setStopRedirecting: f,
            })
          : (0, a.jsxs)(h.ZP, {
              pageConfig: t,
              pageTitle: G,
              title: E ? "".concat(D).concat(_ ? " to ".concat(t.site_display_name) : "") : "",
              showLogo: E,
              bottomChild:
                E && (F || k || P)
                  ? (0, a.jsxs)(l.K, {
                      spacing: "xs",
                      children: [
                        r === x.KZ.LETTER
                          ? (0, a.jsx)(LoginFooters_LetterLoginShellFooter, { loginUITheme: t.theme.login_ui_theme })
                          : r === x.KZ.QUAN
                            ? (0, a.jsx)(LoginFooters_QuanLoginShellFooter, { loginUITheme: t.theme.login_ui_theme })
                            : (0, a.jsx)(LoginFooters_DefaultLoginShellFooter, {
                                loginUITheme: t.theme.login_ui_theme,
                                showSignupButton: F,
                              }),
                        (0, a.jsx)(A.Z, { theme: t.theme }),
                      ],
                    })
                  : void 0,
              pageType: r,
              children: [
                I &&
                  (0, a.jsx)(c.x, {
                    color: p.xR.ErrorButtonColor,
                    align: "center",
                    children: "There are no login options enabled. Contact your administrator to set one up.",
                  }),
                S && (0, a.jsx)(B.Z, { setStopRedirecting: f }),
                ei,
                y && (R || T) && !S && (0, a.jsx)(q.Z, { showDivider: en, isFrameless: L }),
                es,
              ],
            });
      };
    },
    42455: function (e, o, n) {
      n.d(o, {
        K: function () {
          return useFocus;
        },
      });
      var t = n(51584),
        r = n.n(t),
        i = n(67294);
      let useFocus = function () {
        let e = arguments.length > 0 && void 0 !== arguments[0] && arguments[0],
          o = arguments.length > 1 ? arguments[1] : void 0,
          n = arguments.length > 2 && void 0 !== arguments[2] && arguments[2],
          [t, s] = (0, i.useState)(e),
          a = { autoFocus: t, key: "".concat(o).concat(n ? t : ""), onFocus: () => s(!0), onBlur: () => s(!1) };
        return { focus: t, setFocus: (e) => s(!r()(e) || e), focusProps: a };
      };
    },
    53395: function (e, o, n) {
      var t, r, i, s, a, l;
      (n.d(o, {
        $Q: function () {
          return t;
        },
        KZ: function () {
          return r;
        },
        x5: function () {
          return i;
        },
      }),
        ((s = t || (t = {})).DEFAULT = "default"),
        (s.DAGWORKS = "dagworks"),
        ((a = r || (r = {})).DEFAULT = "default"),
        (a.LETTER = "letter"),
        (a.DREAMDATA = "dreamdata"),
        (a.SCRIBBLEVET = "scribblevet"),
        (a.BUILDWITT = "buildwitt"),
        (a.GOVEAGLE = "goveagle"),
        (a.NIJIJOURNEY = "nijijourney"),
        (a.QUAN = "quan"),
        ((l = i || (i = {})).DEFAULT = "default"),
        (l.PRECISION_IT = "precisionit"));
    },
    73758: function (e, o, n) {
      n.d(o, {
        PH: function () {
          return getIndefiniteArticle;
        },
        TI: function () {
          return getDecodedBase64String;
        },
        rT: function () {
          return getCapitalizedIndefiniteArticle;
        },
      });
      let getIndefiniteArticle = (e) => (e.match(/^[aeiou]/i) ? "an" : "a"),
        getCapitalizedIndefiniteArticle = (e) => {
          let o = getIndefiniteArticle(e);
          return o.charAt(0).toUpperCase() + o.slice(1);
        },
        getDecodedBase64String = (e) => {
          try {
            return atob(e);
          } catch (e) {
            return;
          }
        };
    },
  },
]);
