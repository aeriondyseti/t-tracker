package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/aerion/t/internal/client"
	"github.com/aerion/t/internal/model"
	"github.com/spf13/cobra"
)

const daemonAddr = "127.0.0.1:9999"

var rootCmd = &cobra.Command{
	Use:   "t",
	Short: "Personal task tracker",
	Long:  "A frictionless CLI task tracker with daemon and sync backend",
	Run: func(cmd *cobra.Command, args []string) {
		runPicker()
	},
}

// runPicker is the default no-args fzf picker per §6.
func runPicker() {
	if _, err := exec.LookPath("fzf"); err != nil {
		fmt.Fprintln(os.Stderr, "fzf not found. Install it: https://github.com/junegunn/fzf")
		os.Exit(2)
	}
	c := client.New(daemonAddr)
	if err := c.Health(); err != nil {
		fmt.Fprintf(os.Stderr, "daemon not running; run 't daemon start' or 't init'\n")
		os.Exit(2)
	}

	for {
		tasks, err := c.ListTasks(client.ListTasksFilters{})
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(2)
		}
		projects, err := c.ListProjects()
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(2)
		}
		projName := map[string]string{}
		for _, p := range projects {
			projName[p.ID] = p.Name
		}

		var lines []string
		for _, tk := range tasks {
			if tk.DeletedAt != nil {
				continue
			}
			if tk.Status != model.StatusActive && tk.Status != model.StatusInbox && tk.Status != model.StatusBlocked {
				continue
			}
			short := tk.ID
			if len(short) > 8 {
				short = short[:8]
			}
			pn := projName[tk.ProjectID]
			if pn == "" {
				pn = "?"
			}
			tags := ""
			if len(tk.Tags) > 0 {
				tags = "  #" + strings.Join(tk.Tags, " #")
			}
			lines = append(lines, fmt.Sprintf("%s [%s] %s: %s%s", short, tk.Status, pn, tk.Title, tags))
		}

		if len(lines) == 0 {
			fmt.Println("No active tasks. Add one with: t add \"title\"")
			return
		}

		// Pipe to fzf with custom keybinds. We use --expect to capture which key was pressed.
		fzf := exec.Command("fzf",
			"--prompt=task> ",
			"--expect=enter,ctrl-e,ctrl-n,ctrl-d,esc",
			"--header=enter:cycle status  ctrl-e:edit  ctrl-n:new  ctrl-d:archive  esc:exit",
		)
		fzf.Stdin = strings.NewReader(strings.Join(lines, "\n") + "\n")
		fzf.Stderr = os.Stderr
		out, err := fzf.Output()
		if err != nil {
			// exit 130 = user pressed esc/ctrl-c. Other errors propagate.
			if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 130 {
				return
			}
			fmt.Fprintf(os.Stderr, "fzf error: %v\n", err)
			os.Exit(2)
		}

		parts := strings.SplitN(strings.TrimRight(string(out), "\n"), "\n", 2)
		key := parts[0]
		var selected string
		if len(parts) > 1 {
			selected = parts[1]
		}

		if key == "esc" || (selected == "" && key != "ctrl-n") {
			return
		}

		var pickedID string
		if selected != "" {
			short := strings.SplitN(selected, " ", 2)[0]
			id, err := resolveIDPrefix(c, short)
			if err == nil {
				pickedID = id
			}
		}

		switch key {
		case "", "enter":
			if pickedID == "" {
				return
			}
			next := nextStatus(statusOfID(tasks, pickedID))
			_, err := c.UpdateTask(pickedID, client.UpdateTaskRequest{Status: &next})
			if err != nil {
				fmt.Fprintf(os.Stderr, "error: %v\n", err)
			}
		case "ctrl-d":
			if pickedID == "" {
				return
			}
			s := model.StatusArchived
			_, err := c.UpdateTask(pickedID, client.UpdateTaskRequest{Status: &s})
			if err != nil {
				fmt.Fprintf(os.Stderr, "error: %v\n", err)
			}
		case "ctrl-e":
			if pickedID == "" {
				return
			}
			editTaskNotes(c, pickedID)
		case "ctrl-n":
			fmt.Print("New task title: ")
			r := bufio.NewReader(os.Stdin)
			title, _ := r.ReadString('\n')
			title = strings.TrimSpace(title)
			if title == "" {
				continue
			}
			_, err := c.CreateTask(client.CreateTaskRequest{Project: "inbox", Title: title})
			if err != nil {
				fmt.Fprintf(os.Stderr, "error: %v\n", err)
			}
		}
	}
}

func statusOfID(tasks []*model.Task, id string) string {
	for _, t := range tasks {
		if t.ID == id {
			return t.Status
		}
	}
	return model.StatusInbox
}

func nextStatus(s string) string {
	switch s {
	case model.StatusInbox:
		return model.StatusActive
	case model.StatusActive:
		return model.StatusBlocked
	case model.StatusBlocked:
		return model.StatusDone
	case model.StatusDone:
		return model.StatusArchived
	default:
		return model.StatusInbox
	}
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	// Add command
	var addProject string
	var addTags []string
	addCmd := &cobra.Command{
		Use:   "add TITLE",
		Short: "Create a new task",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			c := client.New(daemonAddr)
			if err := c.Health(); err != nil {
				fmt.Fprintf(os.Stderr, "daemon not running; run 't daemon start' or 't init'\n")
				os.Exit(2)
			}

			task, err := c.CreateTask(client.CreateTaskRequest{
				Project: addProject,
				Title:   args[0],
				Tags:    addTags,
			})
			if err != nil {
				fmt.Fprintf(os.Stderr, "error: %v\n", err)
				os.Exit(1)
			}
			fmt.Println(task.ID)
		},
	}
	addCmd.Flags().StringVar(&addProject, "project", "inbox", "Project name")
	addCmd.Flags().StringSliceVar(&addTags, "tag", []string{}, "Tags (can be specified multiple times)")
	rootCmd.AddCommand(addCmd)

	// List command
	var lsAll bool
	var lsProject string
	var lsStatus string
	var lsTag string
	lsCmd := &cobra.Command{
		Use:   "ls",
		Short: "List tasks",
		Run: func(cmd *cobra.Command, args []string) {
			c := client.New(daemonAddr)
			if err := c.Health(); err != nil {
				fmt.Fprintf(os.Stderr, "daemon not running; run 't daemon start' or 't init'\n")
				os.Exit(2)
			}

			tasks, err := c.ListTasks(client.ListTasksFilters{})
			if err != nil {
				fmt.Fprintf(os.Stderr, "error: %v\n", err)
				os.Exit(1)
			}

			// Filter tasks
			filtered := []*model.Task{}
			for _, t := range tasks {
				// Skip deleted
				if t.DeletedAt != nil {
					continue
				}

				// Filter by status
				if !lsAll && t.Status != model.StatusActive && t.Status != model.StatusInbox {
					continue
				}
				if lsStatus != "" && t.Status != lsStatus {
					continue
				}

				// Filter by project
				if lsProject != "" {
					projects, err := c.ListProjects()
					if err != nil {
						fmt.Fprintf(os.Stderr, "error: %v\n", err)
						os.Exit(1)
					}
					projectID := ""
					for _, p := range projects {
						if p.Name == lsProject {
							projectID = p.ID
							break
						}
					}
					if t.ProjectID != projectID {
						continue
					}
				}

				// Filter by tag
				if lsTag != "" {
					hasTag := false
					for _, tag := range t.Tags {
						if tag == lsTag {
							hasTag = true
							break
						}
					}
					if !hasTag {
						continue
					}
				}

				filtered = append(filtered, t)
			}

			// Output tab-separated
			for _, t := range filtered {
				// Get project name
				projects, _ := c.ListProjects()
				projectName := "unknown"
				for _, p := range projects {
					if p.ID == t.ProjectID {
						projectName = p.Name
						break
					}
				}

				shortID := t.ID
				if len(shortID) > 8 {
					shortID = shortID[:8]
				}
				tags := strings.Join(t.Tags, ",")
				fmt.Printf("%s\t%s\t%s\t%s\t%s\n", shortID, t.Status, projectName, t.Title, tags)
			}
		},
	}
	lsCmd.Flags().BoolVar(&lsAll, "all", false, "Include done and archived tasks")
	lsCmd.Flags().StringVar(&lsProject, "project", "", "Filter by project")
	lsCmd.Flags().StringVar(&lsStatus, "status", "", "Filter by status")
	lsCmd.Flags().StringVar(&lsTag, "tag", "", "Filter by tag")
	rootCmd.AddCommand(lsCmd)

	// Status change commands
	makeStatusCmd := func(use, short string, status string) *cobra.Command {
		return &cobra.Command{
			Use:   use + " ID_PREFIX",
			Short: short,
			Args:  cobra.ExactArgs(1),
			Run: func(cmd *cobra.Command, args []string) {
				c := client.New(daemonAddr)
				if err := c.Health(); err != nil {
					fmt.Fprintf(os.Stderr, "daemon not running; run 't daemon start' or 't init'\n")
					os.Exit(2)
				}

				id, err := resolveIDPrefix(c, args[0])
				if err != nil {
					fmt.Fprintf(os.Stderr, "error: %v\n", err)
					os.Exit(1)
				}

				statusVal := status
				_, err = c.UpdateTask(id, client.UpdateTaskRequest{
					Status: &statusVal,
				})
				if err != nil {
					fmt.Fprintf(os.Stderr, "error: %v\n", err)
					os.Exit(1)
				}
			},
		}
	}

	rootCmd.AddCommand(makeStatusCmd("done", "Mark task as done", model.StatusDone))
	rootCmd.AddCommand(makeStatusCmd("start", "Mark task as active", model.StatusActive))
	rootCmd.AddCommand(makeStatusCmd("block", "Mark task as blocked", model.StatusBlocked))
	rootCmd.AddCommand(makeStatusCmd("archive", "Archive task", model.StatusArchived))

	// Edit command — opens notes in $EDITOR
	editCmd := &cobra.Command{
		Use:   "edit ID_PREFIX",
		Short: "Edit task notes in $EDITOR",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			c := client.New(daemonAddr)
			if err := c.Health(); err != nil {
				fmt.Fprintf(os.Stderr, "daemon not running; run 't daemon start' or 't init'\n")
				os.Exit(2)
			}
			id, err := resolveIDPrefix(c, args[0])
			if err != nil {
				fmt.Fprintf(os.Stderr, "error: %v\n", err)
				os.Exit(1)
			}
			editTaskNotes(c, id)
		},
	}
	rootCmd.AddCommand(editCmd)

	// Projects command
	projectsCmd := &cobra.Command{
		Use:   "projects",
		Short: "List all projects",
		Run: func(cmd *cobra.Command, args []string) {
			c := client.New(daemonAddr)
			if err := c.Health(); err != nil {
				fmt.Fprintf(os.Stderr, "daemon not running; run 't daemon start' or 't init'\n")
				os.Exit(2)
			}

			projects, err := c.ListProjects()
			if err != nil {
				fmt.Fprintf(os.Stderr, "error: %v\n", err)
				os.Exit(1)
			}

			for _, p := range projects {
				fmt.Println(p.Name)
			}
		},
	}
	rootCmd.AddCommand(projectsCmd)

	// Project subcommand
	projectCmd := &cobra.Command{
		Use:   "project",
		Short: "Manage projects",
	}

	projectAddCmd := &cobra.Command{
		Use:   "add NAME",
		Short: "Create a new project",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			c := client.New(daemonAddr)
			if err := c.Health(); err != nil {
				fmt.Fprintf(os.Stderr, "daemon not running; run 't daemon start' or 't init'\n")
				os.Exit(2)
			}

			project, err := c.CreateProject(args[0])
			if err != nil {
				fmt.Fprintf(os.Stderr, "error: %v\n", err)
				os.Exit(1)
			}
			fmt.Println(project.ID)
		},
	}

	projectRmCmd := &cobra.Command{
		Use:   "rm NAME",
		Short: "Soft delete a project",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			c := client.New(daemonAddr)
			if err := c.Health(); err != nil {
				fmt.Fprintf(os.Stderr, "daemon not running; run 't daemon start' or 't init'\n")
				os.Exit(2)
			}

			// Find project by name
			projects, err := c.ListProjects()
			if err != nil {
				fmt.Fprintf(os.Stderr, "error: %v\n", err)
				os.Exit(1)
			}

			var projectID string
			for _, p := range projects {
				if p.Name == args[0] {
					projectID = p.ID
					break
				}
			}

			if projectID == "" {
				fmt.Fprintf(os.Stderr, "project not found: %s\n", args[0])
				os.Exit(1)
			}

			// Soft delete
			now := model.Now()
			_, err = c.UpdateProject(projectID, client.UpdateProjectRequest{
				DeletedAt: &now,
			})
			if err != nil {
				fmt.Fprintf(os.Stderr, "error: %v\n", err)
				os.Exit(1)
			}
		},
	}

	projectCmd.AddCommand(projectAddCmd, projectRmCmd)
	rootCmd.AddCommand(projectCmd)

	// Sync command (placeholder)
	syncCmd := &cobra.Command{
		Use:   "sync",
		Short: "Force immediate sync with server",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Fprintf(os.Stderr, "sync command not yet implemented (requires sync engine from Step 8)\n")
			os.Exit(1)
		},
	}
	rootCmd.AddCommand(syncCmd)
}

// editTaskNotes launches $EDITOR on a temp file seeded with current notes,
// then PATCHes the task with whatever was saved.
func editTaskNotes(c *client.Client, id string) {
	editor := os.Getenv("EDITOR")
	if editor == "" {
		editor = "vi"
	}
	t, err := c.GetTask(id)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return
	}
	f, err := os.CreateTemp("", "t-edit-*.md")
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return
	}
	tmpPath := f.Name()
	defer os.Remove(tmpPath)
	_, _ = f.WriteString(t.Notes)
	f.Close()

	ed := exec.Command(editor, tmpPath)
	ed.Stdin = os.Stdin
	ed.Stdout = os.Stdout
	ed.Stderr = os.Stderr
	if err := ed.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "editor exited with error: %v\n", err)
		return
	}
	b, err := os.ReadFile(tmpPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return
	}
	notes := string(b)
	if notes == t.Notes {
		return
	}
	if _, err := c.UpdateTask(id, client.UpdateTaskRequest{Notes: &notes}); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
	}
}

// resolveIDPrefix finds a task by ID prefix
func resolveIDPrefix(c *client.Client, prefix string) (string, error) {
	tasks, err := c.ListTasks(client.ListTasksFilters{})
	if err != nil {
		return "", err
	}

	var matches []string
	for _, t := range tasks {
		if strings.HasPrefix(t.ID, prefix) {
			matches = append(matches, t.ID)
		}
	}

	if len(matches) == 0 {
		return "", fmt.Errorf("no task found with prefix: %s", prefix)
	}
	if len(matches) > 1 {
		return "", fmt.Errorf("ambiguous prefix %s: matches %d tasks", prefix, len(matches))
	}

	return matches[0], nil
}
