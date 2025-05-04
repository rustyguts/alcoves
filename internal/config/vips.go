package config

import "github.com/davidbyttow/govips/v2/vips"

func InitVips() {
	vips.Startup(nil)
	defer vips.Shutdown()
}
