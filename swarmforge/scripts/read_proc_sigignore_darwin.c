/* BL-372: read kp_proc.p_sigignore for a pid via sysctl KERN_PROC_PID.
   macOS Monterey's ps advertises "ignored" but fails at runtime
   (sigignore: keyword not found); this is the portable Darwin path. */
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/sysctl.h>
#include <sys/proc.h>

int main(int argc, char **argv) {
  if (argc != 2) {
    return 2;
  }
  int pid = (int)strtol(argv[1], NULL, 10);
  if (pid <= 0) {
    return 2;
  }
  int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, pid};
  struct kinfo_proc info;
  size_t size = sizeof(info);
  if (sysctl(mib, 4, &info, &size, NULL, 0) != 0) {
    return 1;
  }
  if (size < sizeof(struct extern_proc)) {
    return 1;
  }
  printf("0x%x\n", info.kp_proc.p_sigignore);
  return 0;
}
