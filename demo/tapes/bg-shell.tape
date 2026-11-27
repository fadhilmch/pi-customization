Source demo/tapes/_common.tape
Output docs/media/bg-shell.gif

Hide
Type "source demo/lib/env.sh bg-shell bg-shell claude-look"
Enter
Sleep 4s
Type "pi --provider demo --model demo"
Enter
Sleep 3s
Show

Sleep 500ms
Type "Start the demo server"
Enter
Sleep 4s
Type "/jobs"
Enter
Sleep 1s
Screenshot docs/media/bg-shell.png
Type "q"
Sleep 400ms
Type "Stop background job bg1"
Enter
Sleep 4s
Screenshot docs/media/bg-shell-stopped.png
Sleep 2s
