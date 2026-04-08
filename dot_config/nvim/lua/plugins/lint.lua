return {
  "mfussenegger/nvim-lint",
  opts = {
    -- Event to trigger linting
    events = { "BufWritePost", "BufReadPost", "InsertLeave" },
    linters_by_ft = {
      sql = { "sqlfluff" },
    },
  },
}
