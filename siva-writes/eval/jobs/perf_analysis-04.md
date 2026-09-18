Write the case-study post for an engineering blog read by systems and performance engineers. A short Netflix debugging story, from the material below.

A colleague, Vadim, was reading a CPU flame graph from a TensorFlow workload and picked out an orange kernel tower that did not belong: page-fault work, 10% of all CPU time on the box. Why that number is worth chasing: multiply a tenth of the CPU by a fleet of thousands of instances and the waste is expensive; the team will open a flame graph over a single percentage point, let alone ten.

The faulting stacks led to __memcpy_avx_unaligned() - memcpy touching data segment mappings that were not resident. Early in a process's life that is ordinary, because segments and the heap have no mappings yet. This one had been running for hours, by which point growth of RSS from faults should have flattened off.

One standard reason for heavy faulting is a process cycling memory through mmap() and munmap(). eBPF tracing with mmapsnoop.py recorded no such calls. A flame-graph search on madvise put it at 0.8% of CPU, with the madvise() path reaching zap_page_range(), and that was where the faults came from. Reading the kernel's mm/advise.c settled which flag mattered: MADV_DONTNEED is what sends madvise() into zap_page_range(). Tracing sys_madvise() flags with kprobes or tracepoints would have answered the same question.

Diagnosis: an optimization that backfired. The allocator was declaring pages unneeded that the workload still used; each dontneed threw away the virtual-to-physical mapping, and a page fault then had to put it back.

The allocator turned out to be jemalloc, pulled in by a configure option. Vadim did a rebuild against glibc, which cleared the problem. Measured result: the first round of testing came back at 3%, against the 10% the team had in mind, and the fixed flame graph shows it.