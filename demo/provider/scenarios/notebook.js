// notebook: read a fixture by cells, then edit one markdown cell with notebook_edit.
module.exports = {
  turns: [
    [
      {
        wait: 700,
        text: "I'll inspect the notebook as cells first, then make one focused markdown edit.",
        tools: [["read", { path: "demo.ipynb" }]],
      },
      {
        wait: 500,
        tools: [["notebook_edit", { path: "demo.ipynb", cell: 1, mode: "replace", source: "# Notebook summary\n\nThis demo edits one cell while preserving the rest of the notebook." }]],
      },
      { wait: 500, text: "Updated cell 1. The notebook file stays valid nbformat JSON, and replacing a code cell would clear stale execution output." },
    ],
  ],
};
