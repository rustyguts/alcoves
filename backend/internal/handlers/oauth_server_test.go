package handlers

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/alcoves/alcoves-backend/internal/middleware"
	"github.com/alcoves/alcoves-backend/internal/models"
	oauthservice "github.com/alcoves/alcoves-backend/internal/services/oauth"
)

const testRedirect = "https://claude.ai/api/mcp/auth_callback"

func setupOAuthServer(t *testing.T) (*OAuthServerHandler, *oauthservice.Service, models.User) {
	t.Helper()
	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}
	if err := db.AutoMigrate(
		&models.User{},
		&models.OAuthClient{},
		&models.OAuthAuthorizationCode{},
		&models.OAuthRefreshToken{},
		&models.OAuthAccessToken{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	db.Exec("TRUNCATE TABLE users, oauth_clients, oauth_authorization_codes, oauth_refresh_tokens, oauth_access_tokens RESTART IDENTITY CASCADE")

	svc := oauthservice.New(db, oauthservice.Config{
		Enabled:    true,
		Issuer:     "https://alcoves.example.com",
		AccessTTL:  time.Hour,
		RefreshTTL: 720 * time.Hour,
		CodeTTL:    5 * time.Minute,
		DCREnabled: true,
		Secret:     "oauth-handler-test-secret-32bytes-xx",
	})
	user := models.User{BaseModel: models.BaseModel{ID: uuid.New()}, Email: "u@test.com", DisplayName: "U", Role: "member"}
	db.Create(&user)
	return NewOAuthServerHandler(svc), svc, user
}

func pkceChal(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// jsonBody runs a JSON-body handler call, optionally with a session user.
func jsonCall(t *testing.T, e *echo.Echo, fn echo.HandlerFunc, method, target, body, userID string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if userID != "" {
		c.Set(middleware.ContextKeyUserID, userID)
	}
	if err := fn(c); err != nil {
		// Mirror echo's default error handling so status assertions work.
		e.HTTPErrorHandler(err, c)
	}
	return rec
}

func formCall(t *testing.T, e *echo.Echo, fn echo.HandlerFunc, target string, form url.Values) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, target, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if err := fn(c); err != nil {
		e.HTTPErrorHandler(err, c)
	}
	return rec
}

func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode json (%s): %v", rec.Body.String(), err)
	}
	return m
}

func TestOAuthServerFullFlow(t *testing.T) {
	h, _, user := setupOAuthServer(t)
	e := echo.New()
	uid := user.ID.String()
	verifier := "the-code-verifier-1234567890"

	// 1. Dynamic Client Registration (public).
	rec := jsonCall(t, e, h.Register, http.MethodPost, "/api/oauth/register",
		`{"client_name":"Claude","redirect_uris":["`+testRedirect+`"]}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("register status=%d body=%s", rec.Code, rec.Body.String())
	}
	reg := decodeJSON(t, rec)
	clientID, _ := reg["client_id"].(string)
	if clientID == "" {
		t.Fatalf("no client_id: %v", reg)
	}

	// 2. Authorize (session-required) → consent token.
	q := url.Values{}
	q.Set("client_id", clientID)
	q.Set("redirect_uri", testRedirect)
	q.Set("response_type", "code")
	q.Set("code_challenge", pkceChal(verifier))
	q.Set("code_challenge_method", "S256")
	q.Set("state", "xyz")
	arec := jsonCall(t, e, h.Authorize, http.MethodGet, "/api/oauth/authorize?"+q.Encode(), "", uid)
	if arec.Code != http.StatusOK {
		t.Fatalf("authorize status=%d body=%s", arec.Code, arec.Body.String())
	}
	ares := decodeJSON(t, arec)
	consentToken, _ := ares["consentToken"].(string)
	if consentToken == "" {
		t.Fatalf("no consent token: %v", ares)
	}

	// 3. Decision approve → redirect with code.
	decBody, _ := json.Marshal(map[string]any{
		"consentToken": consentToken, "approve": true,
		"clientId": clientID, "redirectUri": testRedirect,
		"codeChallenge": pkceChal(verifier), "codeChallengeMethod": "S256",
		"scope": "mcp", "state": "xyz", "resource": "https://alcoves.example.com/api/mcp",
	})
	drec := jsonCall(t, e, h.Decision, http.MethodPost, "/api/oauth/authorize/decision", string(decBody), uid)
	if drec.Code != http.StatusOK {
		t.Fatalf("decision status=%d body=%s", drec.Code, drec.Body.String())
	}
	redirect, _ := decodeJSON(t, drec)["redirect"].(string)
	ru, err := url.Parse(redirect)
	if err != nil {
		t.Fatalf("parse redirect: %v", err)
	}
	code := ru.Query().Get("code")
	if code == "" || ru.Query().Get("state") != "xyz" {
		t.Fatalf("bad redirect: %s", redirect)
	}

	// 4. Token exchange (public, form-encoded).
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", clientID)
	form.Set("code", code)
	form.Set("redirect_uri", testRedirect)
	form.Set("code_verifier", verifier)
	trec := formCall(t, e, h.Token, "/api/oauth/token", form)
	if trec.Code != http.StatusOK {
		t.Fatalf("token status=%d body=%s", trec.Code, trec.Body.String())
	}
	if trec.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("token response must set Cache-Control: no-store")
	}
	tres := decodeJSON(t, trec)
	accessToken, _ := tres["access_token"].(string)
	refreshToken, _ := tres["refresh_token"].(string)
	if accessToken == "" || refreshToken == "" {
		t.Fatalf("missing tokens: %v", tres)
	}

	// 5. Refresh grant rotates the pair.
	rform := url.Values{}
	rform.Set("grant_type", "refresh_token")
	rform.Set("client_id", clientID)
	rform.Set("refresh_token", refreshToken)
	rfrec := formCall(t, e, h.Token, "/api/oauth/token", rform)
	if rfrec.Code != http.StatusOK {
		t.Fatalf("refresh status=%d body=%s", rfrec.Code, rfrec.Body.String())
	}
	if newAccess, _ := decodeJSON(t, rfrec)["access_token"].(string); newAccess == "" || newAccess == accessToken {
		t.Fatal("refresh must mint a new access token")
	}

	// 6. Connections list + revoke (session).
	crec := jsonCall(t, e, h.ListConnections, http.MethodGet, "/api/oauth/connections", "", uid)
	if crec.Code != http.StatusOK || !strings.Contains(crec.Body.String(), "Claude") {
		t.Fatalf("connections: status=%d body=%s", crec.Code, crec.Body.String())
	}

	rvreq := httptest.NewRequest(http.MethodDelete, "/api/oauth/connections/"+clientID, nil)
	rvrec := httptest.NewRecorder()
	rvc := e.NewContext(rvreq, rvrec)
	rvc.Set(middleware.ContextKeyUserID, uid)
	rvc.SetParamNames("clientId")
	rvc.SetParamValues(clientID)
	if err := h.RevokeConnection(rvc); err != nil {
		t.Fatalf("revoke connection: %v", err)
	}
	if rvrec.Code != http.StatusNoContent {
		t.Fatalf("revoke status=%d", rvrec.Code)
	}
	// After revoke there should be no connections.
	c2 := jsonCall(t, e, h.ListConnections, http.MethodGet, "/api/oauth/connections", "", uid)
	if strings.Contains(c2.Body.String(), "Claude") {
		t.Fatal("connection should be gone after revoke")
	}
}

func TestAuthorizeRejections(t *testing.T) {
	h, svc, user := setupOAuthServer(t)
	e := echo.New()
	uid := user.ID.String()
	client, _ := svc.RegisterClient(t.Context(), oauthservice.ClientRegistration{
		ClientName: "Claude", RedirectURIs: []string{testRedirect},
	})

	// Missing PKCE challenge → 400 invalid_request.
	q := url.Values{}
	q.Set("client_id", client.ClientID)
	q.Set("redirect_uri", testRedirect)
	q.Set("response_type", "code")
	rec := jsonCall(t, e, h.Authorize, http.MethodGet, "/api/oauth/authorize?"+q.Encode(), "", uid)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing PKCE: status=%d", rec.Code)
	}

	// Unknown client → 401 invalid_client.
	q2 := url.Values{}
	q2.Set("client_id", "alc_oc_nope")
	q2.Set("redirect_uri", testRedirect)
	q2.Set("response_type", "code")
	q2.Set("code_challenge", pkceChal("v"))
	rec2 := jsonCall(t, e, h.Authorize, http.MethodGet, "/api/oauth/authorize?"+q2.Encode(), "", uid)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("unknown client: status=%d body=%s", rec2.Code, rec2.Body.String())
	}

	// Unregistered redirect → 400 invalid_redirect_uri.
	q3 := url.Values{}
	q3.Set("client_id", client.ClientID)
	q3.Set("redirect_uri", "https://claude.ai/evil")
	q3.Set("response_type", "code")
	q3.Set("code_challenge", pkceChal("v"))
	rec3 := jsonCall(t, e, h.Authorize, http.MethodGet, "/api/oauth/authorize?"+q3.Encode(), "", uid)
	if rec3.Code != http.StatusBadRequest {
		t.Fatalf("bad redirect: status=%d", rec3.Code)
	}
}

func TestTokenBadVerifier(t *testing.T) {
	h, svc, user := setupOAuthServer(t)
	e := echo.New()
	client, _ := svc.RegisterClient(t.Context(), oauthservice.ClientRegistration{
		ClientName: "Claude", RedirectURIs: []string{testRedirect},
	})
	code, _ := svc.IssueCode(t.Context(), user.ID, oauthservice.AuthorizeRequest{
		ClientID: client.ClientID, RedirectURI: testRedirect, ResponseType: "code",
		CodeChallenge: pkceChal("right"), CodeChallengeMethod: "S256", Scope: "mcp",
	})
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", client.ClientID)
	form.Set("code", code)
	form.Set("redirect_uri", testRedirect)
	form.Set("code_verifier", "wrong")
	rec := formCall(t, e, h.Token, "/api/oauth/token", form)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_grant") {
		t.Fatalf("bad verifier: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRegisterBadRedirect(t *testing.T) {
	h, _, _ := setupOAuthServer(t)
	e := echo.New()
	rec := jsonCall(t, e, h.Register, http.MethodPost, "/api/oauth/register",
		`{"client_name":"X","redirect_uris":["http://evil.example.com/cb"]}`, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("http non-loopback redirect must be rejected: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRevokeAlwaysOK(t *testing.T) {
	h, _, _ := setupOAuthServer(t)
	e := echo.New()
	form := url.Values{}
	form.Set("token", "alc_oat_doesnotexist")
	rec := formCall(t, e, h.Revoke, "/api/oauth/revoke", form)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke of unknown token must be 200, got %d", rec.Code)
	}
}

func TestAuthorizeRejectsForeignResource(t *testing.T) {
	h, svc, user := setupOAuthServer(t)
	e := echo.New()
	uid := user.ID.String()
	client, _ := svc.RegisterClient(t.Context(), oauthservice.ClientRegistration{
		ClientName: "Claude", RedirectURIs: []string{testRedirect},
	})
	q := url.Values{}
	q.Set("client_id", client.ClientID)
	q.Set("redirect_uri", testRedirect)
	q.Set("response_type", "code")
	q.Set("code_challenge", pkceChal("v"))
	q.Set("resource", "https://evil.example.com/api/mcp")
	rec := jsonCall(t, e, h.Authorize, http.MethodGet, "/api/oauth/authorize?"+q.Encode(), "", uid)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_target") {
		t.Fatalf("foreign resource must be rejected with invalid_target: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRegisterDCRDisabled(t *testing.T) {
	dsn := "postgres://postgres:postgres@localhost:5455/alcoves_test"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Skipf("Skipping test: database not available: %v", err)
	}
	if err := db.AutoMigrate(&models.OAuthClient{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	svc := oauthservice.New(db, oauthservice.Config{
		Enabled: true, Issuer: "https://alcoves.example.com", DCREnabled: false,
		Secret: "oauth-handler-test-secret-32bytes-xx",
	})
	h := NewOAuthServerHandler(svc)
	e := echo.New()
	rec := jsonCall(t, e, h.Register, http.MethodPost, "/api/oauth/register",
		`{"client_name":"X","redirect_uris":["https://claude.ai/cb"]}`, "")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "access_denied") {
		t.Fatalf("DCR-disabled register must return access_denied: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMetadataEndpoints(t *testing.T) {
	h, _, _ := setupOAuthServer(t)
	e := echo.New()
	h.RegisterWellKnown(e)

	for _, path := range []string{
		"/.well-known/oauth-protected-resource",
		"/.well-known/oauth-authorization-server",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status=%d", path, rec.Code)
		}
		if rec.Header().Get("Access-Control-Allow-Origin") != "*" {
			t.Fatalf("%s must be CORS-open", path)
		}
	}
}
