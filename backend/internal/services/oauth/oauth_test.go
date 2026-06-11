package oauth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/alcoves/alcoves-backend/internal/models"
	"github.com/alcoves/alcoves-backend/internal/testsupport"
)

func newTestService(t *testing.T) (*Service, *gorm.DB, models.User) {
	t.Helper()
	db := testsupport.OpenSchema(t, "svc_oauth")
	if err := db.AutoMigrate(
		&models.User{},
		&models.OAuthClient{},
		&models.OAuthAuthorizationCode{},
		&models.OAuthRefreshToken{},
		&models.OAuthAccessToken{},
	); err != nil {
		t.Fatalf("AutoMigrate: %v", err)
	}
	db.Exec("TRUNCATE TABLE users, oauth_clients, oauth_authorization_codes, oauth_refresh_tokens, oauth_access_tokens RESTART IDENTITY CASCADE")

	svc := New(db, Config{
		Enabled:    true,
		Issuer:     "https://alcoves.example.com/",
		AccessTTL:  time.Hour,
		RefreshTTL: 720 * time.Hour,
		CodeTTL:    5 * time.Minute,
		DCREnabled: true,
		Secret:     "test-secret-at-least-32-bytes-long-aaaa",
	})

	u := models.User{Email: "u@example.com", DisplayName: "U", Role: "member"}
	if err := db.Create(&u).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return svc, db, u
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func mustClient(t *testing.T, svc *Service, redirect string) *models.OAuthClient {
	t.Helper()
	c, err := svc.RegisterClient(context.Background(), ClientRegistration{
		ClientName:   "Claude",
		RedirectURIs: []string{redirect},
	})
	if err != nil {
		t.Fatalf("RegisterClient: %v", err)
	}
	return c
}

func TestRegisterClient(t *testing.T) {
	svc, _, _ := newTestService(t)
	ctx := context.Background()

	c, err := svc.RegisterClient(ctx, ClientRegistration{
		ClientName:   "Claude",
		RedirectURIs: []string{"https://claude.ai/api/mcp/auth_callback"},
	})
	if err != nil {
		t.Fatalf("RegisterClient: %v", err)
	}
	if c.ClientID == "" || c.ClientName != "Claude" {
		t.Fatalf("unexpected client: %+v", c)
	}
	if len(c.GrantTypes) != 2 {
		t.Fatalf("expected default grant types, got %v", c.GrantTypes)
	}

	// Default client name when omitted.
	c2, err := svc.RegisterClient(ctx, ClientRegistration{RedirectURIs: []string{"https://x.example.com/cb"}})
	if err != nil {
		t.Fatalf("RegisterClient(no name): %v", err)
	}
	if c2.ClientName == "" {
		t.Fatal("expected a default client name")
	}

	// Round-trips through GetClient with redirect array intact.
	got, err := svc.GetClient(ctx, c.ClientID)
	if err != nil || got == nil {
		t.Fatalf("GetClient: %v %v", got, err)
	}
	if !RedirectAllowed(got, "https://claude.ai/api/mcp/auth_callback") {
		t.Fatal("redirect should be allowed")
	}
	if RedirectAllowed(got, "https://evil.example.com/cb") {
		t.Fatal("unregistered redirect must not be allowed")
	}
}

func TestRegisterClientRejectsBadRedirects(t *testing.T) {
	svc, _, _ := newTestService(t)
	ctx := context.Background()

	cases := []ClientRegistration{
		{RedirectURIs: nil},                                     // none
		{RedirectURIs: []string{"not-a-url"}},                   // relative
		{RedirectURIs: []string{"http://example.com/cb"}},       // http non-loopback
		{RedirectURIs: []string{"https://example.com/cb#frag"}}, // fragment
	}
	for i, reg := range cases {
		if _, err := svc.RegisterClient(ctx, reg); err == nil {
			t.Fatalf("case %d: expected rejection for %+v", i, reg.RedirectURIs)
		}
	}

	// Loopback http is allowed (native/desktop clients).
	if _, err := svc.RegisterClient(ctx, ClientRegistration{RedirectURIs: []string{"http://127.0.0.1:33419/callback"}}); err != nil {
		t.Fatalf("loopback http should be allowed: %v", err)
	}
}

func TestRegisterClientDCRDisabled(t *testing.T) {
	svc, _, _ := newTestService(t)
	svc.cfg.DCREnabled = false
	if _, err := svc.RegisterClient(context.Background(), ClientRegistration{RedirectURIs: []string{"https://claude.ai/cb"}}); err == nil {
		t.Fatal("expected DCR-disabled error")
	}
}

func TestRedirectHostAllowlist(t *testing.T) {
	svc, _, _ := newTestService(t)
	svc.cfg.AllowedRedirectHosts = []string{"claude.ai", "claude.com"}

	if err := svc.validateRedirectURI("https://claude.ai/api/mcp/auth_callback"); err != nil {
		t.Fatalf("claude.ai should be allowed: %v", err)
	}
	if err := svc.validateRedirectURI("https://evil.example.com/cb"); err == nil {
		t.Fatal("non-allowlisted host must be rejected")
	}
	// Loopback bypasses the allowlist.
	if err := svc.validateRedirectURI("http://127.0.0.1:9000/cb"); err != nil {
		t.Fatalf("loopback should bypass allowlist: %v", err)
	}
}

func TestPKCE(t *testing.T) {
	if !verifyPKCE(pkceChallenge("verifier123"), "S256", "verifier123") {
		t.Fatal("valid S256 verifier should pass")
	}
	if verifyPKCE(pkceChallenge("verifier123"), "S256", "wrong") {
		t.Fatal("wrong verifier must fail")
	}
	if verifyPKCE("anything", "plain", "anything") {
		t.Fatal("plain method must be rejected (OAuth 2.1)")
	}
	if verifyPKCE("", "S256", "v") || verifyPKCE("c", "S256", "") {
		t.Fatal("empty challenge/verifier must fail")
	}
}

func authReq(client *models.OAuthClient, redirect, verifier string) AuthorizeRequest {
	return AuthorizeRequest{
		ClientID:            client.ClientID,
		RedirectURI:         redirect,
		ResponseType:        "code",
		CodeChallenge:       pkceChallenge(verifier),
		CodeChallengeMethod: "S256",
		Scope:               DefaultScope,
		Resource:            "https://alcoves.example.com/api/mcp",
	}
}

func TestExchangeCodeHappyPath(t *testing.T) {
	svc, _, u := newTestService(t)
	ctx := context.Background()
	redirect := "https://claude.ai/api/mcp/auth_callback"
	client := mustClient(t, svc, redirect)
	r := authReq(client, redirect, "the-verifier")

	code, err := svc.IssueCode(ctx, u.ID, r)
	if err != nil {
		t.Fatalf("IssueCode: %v", err)
	}

	res, err := svc.ExchangeCode(ctx, client.ClientID, code, redirect, "the-verifier")
	if err != nil {
		t.Fatalf("ExchangeCode: %v", err)
	}
	if res.AccessToken == "" || res.RefreshToken == "" {
		t.Fatal("expected access + refresh tokens")
	}
	if res.TokenType != "Bearer" || res.ExpiresIn != 3600 {
		t.Fatalf("unexpected token metadata: %+v", res)
	}

	// Access token validates back to the user.
	gotUser, at, err := svc.ValidateAccessToken(ctx, res.AccessToken)
	if err != nil || gotUser == nil || gotUser.ID != u.ID {
		t.Fatalf("ValidateAccessToken: %v %v", gotUser, err)
	}
	if at.Resource != "https://alcoves.example.com/api/mcp" {
		t.Fatalf("access token resource not bound: %q", at.Resource)
	}

	// Replay: second exchange of the same code must fail.
	if _, err := svc.ExchangeCode(ctx, client.ClientID, code, redirect, "the-verifier"); err == nil {
		t.Fatal("code replay must be rejected")
	}
}

func TestExchangeCodeRejections(t *testing.T) {
	svc, _, u := newTestService(t)
	ctx := context.Background()
	redirect := "https://claude.ai/api/mcp/auth_callback"
	client := mustClient(t, svc, redirect)

	issue := func() string {
		c, err := svc.IssueCode(ctx, u.ID, authReq(client, redirect, "verifier"))
		if err != nil {
			t.Fatalf("IssueCode: %v", err)
		}
		return c
	}

	// Wrong PKCE verifier.
	if _, err := svc.ExchangeCode(ctx, client.ClientID, issue(), redirect, "nope"); err == nil {
		t.Fatal("wrong verifier must fail")
	}
	// Wrong client.
	if _, err := svc.ExchangeCode(ctx, "alc_oc_other", issue(), redirect, "verifier"); err == nil {
		t.Fatal("wrong client must fail")
	}
	// Wrong redirect.
	if _, err := svc.ExchangeCode(ctx, client.ClientID, issue(), "https://claude.ai/other", "verifier"); err == nil {
		t.Fatal("wrong redirect must fail")
	}
	// Unknown code.
	if _, err := svc.ExchangeCode(ctx, client.ClientID, "alc_oac_unknown", redirect, "verifier"); err == nil {
		t.Fatal("unknown code must fail")
	}
}

func TestExchangeCodeExpired(t *testing.T) {
	svc, db, u := newTestService(t)
	ctx := context.Background()
	redirect := "https://claude.ai/cb"
	client := mustClient(t, svc, redirect)

	// Insert an already-expired code directly.
	code := "alc_oac_expiredsample"
	rec := &models.OAuthAuthorizationCode{
		CodeHash:            hashToken(code),
		ClientID:            client.ClientID,
		UserID:              u.ID,
		RedirectURI:         redirect,
		CodeChallenge:       pkceChallenge("v"),
		CodeChallengeMethod: "S256",
		Scope:               DefaultScope,
		ExpiresAt:           time.Now().Add(-time.Minute),
	}
	if err := db.Create(rec).Error; err != nil {
		t.Fatalf("seed code: %v", err)
	}
	if _, err := svc.ExchangeCode(ctx, client.ClientID, code, redirect, "v"); err == nil {
		t.Fatal("expired code must be rejected")
	}
}

func TestRefreshRotationAndReuse(t *testing.T) {
	svc, _, u := newTestService(t)
	ctx := context.Background()
	redirect := "https://claude.ai/cb"
	client := mustClient(t, svc, redirect)

	code, _ := svc.IssueCode(ctx, u.ID, authReq(client, redirect, "v"))
	first, err := svc.ExchangeCode(ctx, client.ClientID, code, redirect, "v")
	if err != nil {
		t.Fatalf("ExchangeCode: %v", err)
	}

	// Refresh rotates to a new pair.
	second, err := svc.Refresh(ctx, client.ClientID, first.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if second.RefreshToken == first.RefreshToken || second.AccessToken == first.AccessToken {
		t.Fatal("refresh must rotate the token pair")
	}

	// Reusing the now-rotated refresh token must fail AND revoke the chain.
	if _, err := svc.Refresh(ctx, client.ClientID, first.RefreshToken); err == nil {
		t.Fatal("reuse of rotated refresh token must fail")
	}
	if _, err := svc.Refresh(ctx, client.ClientID, second.RefreshToken); err == nil {
		t.Fatal("chain should be revoked after reuse detection")
	}

	// Wrong client cannot refresh.
	fresh, _ := svc.ExchangeCode(ctx, client.ClientID, mustIssue(t, svc, u.ID, authReq(client, redirect, "v2")), redirect, "v2")
	if _, err := svc.Refresh(ctx, "alc_oc_other", fresh.RefreshToken); err == nil {
		t.Fatal("refresh with wrong client must fail")
	}
}

func mustIssue(t *testing.T, svc *Service, userID uuid.UUID, r AuthorizeRequest) string {
	t.Helper()
	c, err := svc.IssueCode(context.Background(), userID, r)
	if err != nil {
		t.Fatalf("IssueCode: %v", err)
	}
	return c
}

func TestValidateAccessTokenEdges(t *testing.T) {
	svc, db, u := newTestService(t)
	ctx := context.Background()

	// Non-oauth prefix (e.g. a PAT) is not ours → (nil,nil,nil).
	if user, _, err := svc.ValidateAccessToken(ctx, "alc_pat_something"); user != nil || err != nil {
		t.Fatal("PAT-prefixed token must be ignored by the oauth validator")
	}
	// Unknown token.
	if user, _, _ := svc.ValidateAccessToken(ctx, "alc_oat_unknown"); user != nil {
		t.Fatal("unknown token must return nil user")
	}
	// Expired token.
	tok := "alc_oat_expiredsample"
	at := &models.OAuthAccessToken{
		TokenHash: hashToken(tok),
		ClientID:  "alc_oc_x",
		UserID:    u.ID,
		Scope:     DefaultScope,
		ExpiresAt: time.Now().Add(-time.Minute),
	}
	if err := db.Create(at).Error; err != nil {
		t.Fatalf("seed token: %v", err)
	}
	if user, _, _ := svc.ValidateAccessToken(ctx, tok); user != nil {
		t.Fatal("expired token must return nil user")
	}
}

func TestConsentToken(t *testing.T) {
	svc, _, u := newTestService(t)
	r := AuthorizeRequest{
		ClientID:            "alc_oc_x",
		RedirectURI:         "https://claude.ai/cb",
		CodeChallenge:       "chal",
		CodeChallengeMethod: "S256",
		Scope:               DefaultScope,
		Resource:            "https://alcoves.example.com/api/mcp",
	}
	tok := svc.NewConsentToken(r, u.ID)
	if !svc.VerifyConsentToken(tok, r, u.ID) {
		t.Fatal("freshly minted consent token must verify")
	}
	// Tampered request.
	bad := r
	bad.RedirectURI = "https://claude.ai/evil"
	if svc.VerifyConsentToken(tok, bad, u.ID) {
		t.Fatal("consent token must not verify against a tampered request")
	}
	// Different user.
	if svc.VerifyConsentToken(tok, r, uuid.New()) {
		t.Fatal("consent token must be bound to the user")
	}
	// Garbage.
	if svc.VerifyConsentToken("garbage", r, u.ID) {
		t.Fatal("garbage token must not verify")
	}
}

func TestConnectionsAndRevoke(t *testing.T) {
	svc, _, u := newTestService(t)
	ctx := context.Background()
	redirect := "https://claude.ai/cb"
	client := mustClient(t, svc, redirect)

	code, _ := svc.IssueCode(ctx, u.ID, authReq(client, redirect, "v"))
	res, err := svc.ExchangeCode(ctx, client.ClientID, code, redirect, "v")
	if err != nil {
		t.Fatalf("ExchangeCode: %v", err)
	}

	conns, err := svc.ListConnections(ctx, u.ID)
	if err != nil {
		t.Fatalf("ListConnections: %v", err)
	}
	if len(conns) != 1 || conns[0].ClientName != "Claude" {
		t.Fatalf("expected one Claude connection, got %+v", conns)
	}

	if err := svc.RevokeConnection(ctx, u.ID, client.ClientID); err != nil {
		t.Fatalf("RevokeConnection: %v", err)
	}
	if user, _, _ := svc.ValidateAccessToken(ctx, res.AccessToken); user != nil {
		t.Fatal("access token must be invalid after revoke")
	}
	conns, _ = svc.ListConnections(ctx, u.ID)
	if len(conns) != 0 {
		t.Fatalf("expected no connections after revoke, got %+v", conns)
	}
}

func TestMetadata(t *testing.T) {
	svc, _, _ := newTestService(t)

	prm := svc.ProtectedResourceMetadata()
	if prm.Resource != "https://alcoves.example.com/api/mcp" {
		t.Fatalf("resource: %q", prm.Resource)
	}
	if len(prm.AuthorizationServers) != 1 || prm.AuthorizationServers[0] != "https://alcoves.example.com" {
		t.Fatalf("authorization_servers: %v", prm.AuthorizationServers)
	}

	asm := svc.AuthServerMetadata()
	if asm.Issuer != "https://alcoves.example.com" {
		t.Fatalf("issuer: %q", asm.Issuer)
	}
	if asm.AuthorizationEndpoint != "https://alcoves.example.com/oauth/authorize" {
		t.Fatalf("authorization_endpoint: %q", asm.AuthorizationEndpoint)
	}
	if asm.TokenEndpoint != "https://alcoves.example.com/api/oauth/token" {
		t.Fatalf("token_endpoint: %q", asm.TokenEndpoint)
	}
	if asm.RegistrationEndpoint != "https://alcoves.example.com/api/oauth/register" {
		t.Fatalf("registration_endpoint: %q", asm.RegistrationEndpoint)
	}
	if len(asm.CodeChallengeMethodsSupported) != 1 || asm.CodeChallengeMethodsSupported[0] != "S256" {
		t.Fatalf("must advertise S256 only: %v", asm.CodeChallengeMethodsSupported)
	}
}

func TestRegisterClientRejectsSpoofedLoopback(t *testing.T) {
	svc, _, _ := newTestService(t)
	ctx := context.Background()
	// A publicly-resolvable host that merely *looks* like loopback must NOT be
	// treated as loopback (which would bypass the https requirement + allowlist).
	spoofs := []string{
		"http://127.0.0.1.attacker.com/cb",
		"http://127.evil.com/cb",
	}
	for _, s := range spoofs {
		if _, err := svc.RegisterClient(ctx, ClientRegistration{RedirectURIs: []string{s}}); err == nil {
			t.Fatalf("spoofed-loopback redirect %q must be rejected", s)
		}
	}
	// A genuine loopback IP literal is still allowed.
	if _, err := svc.RegisterClient(ctx, ClientRegistration{RedirectURIs: []string{"http://127.0.0.1:8080/cb"}}); err != nil {
		t.Fatalf("genuine loopback should be allowed: %v", err)
	}
}

func TestNormalizeScope(t *testing.T) {
	svc, _, _ := newTestService(t)
	cases := map[string]string{
		"":            DefaultScope, // empty → default
		"mcp":         "mcp",
		"mcp mcp":     "mcp",        // de-duplicated
		"mcp admin":   "mcp",        // unknown token dropped
		"admin write": DefaultScope, // nothing supported → default
	}
	for in, want := range cases {
		if got := svc.NormalizeScope(in); got != want {
			t.Fatalf("NormalizeScope(%q)=%q, want %q", in, got, want)
		}
	}
}

func TestValidateAccessTokenResourceMismatch(t *testing.T) {
	svc, db, u := newTestService(t)
	ctx := context.Background()
	tok := "alc_oat_foreignaudience"
	at := &models.OAuthAccessToken{
		TokenHash: hashToken(tok),
		ClientID:  "alc_oc_x",
		UserID:    u.ID,
		Scope:     DefaultScope,
		Resource:  "https://evil.example.com/api/mcp",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(at).Error; err != nil {
		t.Fatalf("seed token: %v", err)
	}
	if user, _, _ := svc.ValidateAccessToken(ctx, tok); user != nil {
		t.Fatal("token bound to a foreign resource must be rejected (RFC 8707 audience binding)")
	}
}

func TestConsentTokenBindsStateAndResource(t *testing.T) {
	svc, _, u := newTestService(t)
	r := AuthorizeRequest{
		ClientID:            "alc_oc_x",
		RedirectURI:         "https://claude.ai/cb",
		CodeChallenge:       "chal",
		CodeChallengeMethod: "S256",
		Scope:               DefaultScope,
		Resource:            svc.Resource(),
		State:               "abc123",
	}
	tok := svc.NewConsentToken(r, u.ID)
	if !svc.VerifyConsentToken(tok, r, u.ID) {
		t.Fatal("matching request must verify")
	}
	badState := r
	badState.State = "tampered"
	if svc.VerifyConsentToken(tok, badState, u.ID) {
		t.Fatal("tampered state must invalidate the consent token")
	}
	badRes := r
	badRes.Resource = "https://evil.example.com/api/mcp"
	if svc.VerifyConsentToken(tok, badRes, u.ID) {
		t.Fatal("tampered resource must invalidate the consent token")
	}
}

func TestRefreshReuseInvalidatesAccessTokens(t *testing.T) {
	svc, _, u := newTestService(t)
	ctx := context.Background()
	redirect := "https://claude.ai/cb"
	client := mustClient(t, svc, redirect)

	code, _ := svc.IssueCode(ctx, u.ID, authReq(client, redirect, "v"))
	first, err := svc.ExchangeCode(ctx, client.ClientID, code, redirect, "v")
	if err != nil {
		t.Fatalf("ExchangeCode: %v", err)
	}
	if user, _, _ := svc.ValidateAccessToken(ctx, first.AccessToken); user == nil {
		t.Fatal("freshly issued access token should validate")
	}

	second, err := svc.Refresh(ctx, client.ClientID, first.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	// Reusing the rotated refresh token trips reuse detection → chain revoked.
	if _, err := svc.Refresh(ctx, client.ClientID, first.RefreshToken); err == nil {
		t.Fatal("reuse of a rotated refresh token must fail")
	}
	// Both access tokens must now be dead — revocation cannot leave live access.
	if user, _, _ := svc.ValidateAccessToken(ctx, first.AccessToken); user != nil {
		t.Fatal("first access token must be invalidated after reuse detection")
	}
	if user, _, _ := svc.ValidateAccessToken(ctx, second.AccessToken); user != nil {
		t.Fatal("second access token must be invalidated after reuse detection")
	}
}

func TestRevokeTokenCascadesToAccess(t *testing.T) {
	svc, _, u := newTestService(t)
	ctx := context.Background()
	redirect := "https://claude.ai/cb"
	client := mustClient(t, svc, redirect)

	code, _ := svc.IssueCode(ctx, u.ID, authReq(client, redirect, "v"))
	res, err := svc.ExchangeCode(ctx, client.ClientID, code, redirect, "v")
	if err != nil {
		t.Fatalf("ExchangeCode: %v", err)
	}
	if user, _, _ := svc.ValidateAccessToken(ctx, res.AccessToken); user == nil {
		t.Fatal("access token should be valid before revoke")
	}
	if err := svc.RevokeToken(ctx, res.RefreshToken); err != nil {
		t.Fatalf("RevokeToken: %v", err)
	}
	if user, _, _ := svc.ValidateAccessToken(ctx, res.AccessToken); user != nil {
		t.Fatal("revoking the refresh token (RFC 7009) must invalidate its access token")
	}
}
