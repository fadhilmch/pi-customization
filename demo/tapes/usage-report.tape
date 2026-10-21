Output docs/media/usage-report.gif
Source demo/tapes/_common.tape
Set Height 760

Hide
Type "source demo/lib/env.sh subagent subagent usage-report claude-look"
Enter
Sleep 4s
Type "pi --provider demo --model demo"
Enter
Sleep 3s
Show

Sleep 500ms
Type "Where is slugify used, and why does its test fail?"
Enter
Sleep 12s
Type "/context"
Sleep 500ms
Enter
Sleep 2s
Screenshot docs/media/usage-report-context.png
Sleep 1s
Escape
Sleep 1s
Type "/cost"
Sleep 500ms
Enter
Sleep 2s
Screenshot docs/media/usage-report-cost.png
Sleep 1s
Escape
Sleep 1s
Type "/agents"
Sleep 500ms
Enter
Sleep 2s
Screenshot docs/media/subagent-agents.png
Sleep 1s
Escape
Sleep 1s
