// Package migrations embeds the SQL migration files so they can be
// compiled into the binary and applied at runtime without relying on
// the filesystem.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
