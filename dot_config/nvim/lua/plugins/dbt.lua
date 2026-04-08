return {
  "PedramNavid/dbtpal",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-telescope/telescope.nvim",
  },
  ft = { "sql", "md", "yaml" },
  keys = {
    { "<leader>dr", "<cmd>DbtRun<cr>", desc = "dbt run current" },
    { "<leader>dt", "<cmd>DbtTest<cr>", desc = "dbt test current" },
    { "<leader>dc", "<cmd>DbtCompile<cr>", desc = "dbt compile current" },
    { "<leader>dm", "<cmd>lua require('dbtpal.telescope').show_upstream_nodes()<cr>", desc = "dbt upstream" },
  },
  opts = {
    path_to_dbt = "dbt",
    path_to_dbt_project = "", -- Auto-detects based on open buffer
    path_to_dbt_profiles_dir = vim.fn.expand("~/.dbt"),
  },
}
