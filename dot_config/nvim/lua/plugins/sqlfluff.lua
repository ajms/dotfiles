-- SQLFluff integration for LazyVim (nvim-lint + conform.nvim)
-- Requires: `sqlfluff` in PATH (e.g. via `pipx install sqlfluff`)

return {
  -- Linting via nvim-lint
  {
    "mfussenegger/nvim-lint",
    opts = function(_, opts)
      opts.linters_by_ft = opts.linters_by_ft or {}
      opts.linters_by_ft.sql = opts.linters_by_ft.sql or {}
      -- Add sqlfluff as a linter for SQL files
      table.insert(opts.linters_by_ft.sql, "sqlfluff")

      opts.linters = opts.linters or {}
      opts.linters.sqlfluff = {
        cmd = "sqlfluff",
        stdin = false,
        args = {
          "lint",
          "--format=json",
          "--dialect=bigquery", -- <--- change dialect here if needed
        },
      }
    end,
  },

  -- Formatting via conform.nvim
  {
    "stevearc/conform.nvim",
    opts = function(_, opts)
      opts.formatters_by_ft = opts.formatters_by_ft or {}
      opts.formatters_by_ft.sql = opts.formatters_by_ft.sql or {}
      -- Use sqlfluff as a formatter for SQL files
      table.insert(opts.formatters_by_ft.sql, "sqlfluff")

      opts.formatters = opts.formatters or {}
      opts.formatters.sqlfluff = {
        command = "sqlfluff",
        args = {
          "fix",
          "--dialect=bigquery", -- <--- change dialect here if needed
          "--force",
          "--nocolor",
          "-",
        },
        stdin = true,
      }
    end,
  },
}
