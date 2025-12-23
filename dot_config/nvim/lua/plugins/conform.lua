return {
  "stevearc/conform.nvim",
  opts = {
    formatters_by_ft = {
      json = { "jq" },
    },
    formatters = {
      jq = {
        command = "jq",
        args = { "." },
      },
    },
  },
}
