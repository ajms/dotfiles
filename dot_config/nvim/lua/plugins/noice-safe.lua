-- ~/.config/nvim/lua/plugins/noice-safe.lua
return {
  {
    "folke/noice.nvim",
    opts = {
      messages = { enabled = false },
      cmdline = { enabled = false },
      popupmenu = { enabled = true }, -- keep this nice UX
      lsp = {
        progress = { enabled = false },
        hover = { enabled = false },
        signature = { enabled = false },
        override = {},
      },
      presets = { bottom_search = true, command_palette = false, long_message_to_split = true },
    },
  },
}
