Set WshShell = CreateObject("WScript.Shell")
WshShell.Environment("Process")("PYTHONIOENCODING") = "utf-8"
WshShell.CurrentDirectory = "C:\Users\binet\Desktop\Prosp_UpV25"
WshShell.Run "cmd /c set PYTHONIOENCODING=utf-8 && python app.py --prod", 0, False
