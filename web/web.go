package web

import "embed"

//go:embed css/* js/* favicon.svg index.html
var WebFiles embed.FS
