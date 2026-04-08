return {
  "lervag/vimtex",
  lazy = false, -- VimTeX recommends not lazy-loading
  init = function()
    -- Set the engine to lualatex
    vim.g.vimtex_compiler_method = "latexmk"
    vim.g.vimtex_compiler_latexmk = {
      options = {
        "-shell-escape",
        "-verbose",
        "-file-line-error",
        "-synctex=1",
        "-interaction=nonstopmode",
        "-lualatex", -- This is the magic flag
      },
    }
  end,
}
