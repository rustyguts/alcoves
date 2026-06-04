// Package mcpserver builds the Alcoves Model Context Protocol server: the tool
// set plus the identity seam that lets the same tools run over stdio (single
// user, PAT-resolved) and over HTTP (per-request bearer identity). Transport
// wiring lives in cmd/mcp (stdio) and cmd/server (HTTP).
package mcpserver

import (
	"context"

	"github.com/google/uuid"

	"github.com/alcoves/alcoves-backend/internal/models"
)

// Identity is the acting user for a tool call. Tool handlers only ever read
// this, so they are transport-agnostic.
type Identity interface {
	UserID() uuid.UUID
	User() *models.User
}

// StaticIdentity is a fixed identity — used by the single-user stdio transport.
type StaticIdentity struct{ u *models.User }

func NewStaticIdentity(u *models.User) StaticIdentity { return StaticIdentity{u: u} }

func (s StaticIdentity) UserID() uuid.UUID  { return s.u.ID }
func (s StaticIdentity) User() *models.User { return s.u }

type identityKey struct{}

// WithIdentity attaches an Identity to a context (used by the HTTP transport
// per request).
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, identityKey{}, id)
}

// IdentityFrom extracts an Identity previously stored with WithIdentity.
func IdentityFrom(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityKey{}).(Identity)
	return id, ok && id != nil
}
