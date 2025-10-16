-- plugins/treesitter.lua
return {
  "nvim-treesitter/nvim-treesitter",
  build = ":TSUpdate",
  opts = {
    ensure_installed = {
      "lua",
      "vim",
      "bash",
      "python",
      "json",
      "markdown",
      "markdown_inline",
      "sql",
      "pgsql", -- add these
    },
    highlight = { enable = true },
  },
}
