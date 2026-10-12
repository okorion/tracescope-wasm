use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct Handle {
    pub index: u32,
    pub generation: u32,
}

#[derive(Debug)]
pub struct Slot<T> {
    pub generation: u32,
    pub value: Option<T>,
    pub retired: bool,
    pub allocations: u64,
    pub last_allocated_ms: Option<u64>,
    pub last_released_ms: Option<u64>,
}

/// This arena owns span values, not the Rust heap or the WASM linear memory.
/// Generation exhaustion permanently retires a slot, preventing ABA wraparound.
#[derive(Debug)]
pub struct Arena<T> {
    pub slots: Vec<Slot<T>>,
    free_list: Vec<u32>,
    pub allocations: u64,
    pub releases: u64,
    pub reused: u64,
    pub occupied: usize,
    pub retired: usize,
}

impl<T> Default for Arena<T> {
    fn default() -> Self {
        Self {
            slots: Vec::new(),
            free_list: Vec::new(),
            allocations: 0,
            releases: 0,
            reused: 0,
            occupied: 0,
            retired: 0,
        }
    }
}

impl<T> Arena<T> {
    pub fn allocate(&mut self, value: T, now: u64) -> Handle {
        self.allocations += 1;
        self.occupied += 1;
        if let Some(index) = self.free_list.pop() {
            let slot = &mut self.slots[index as usize];
            debug_assert!(!slot.retired && slot.value.is_none());
            slot.value = Some(value);
            slot.allocations += 1;
            slot.last_allocated_ms = Some(now);
            self.reused += 1;
            Handle {
                index,
                generation: slot.generation,
            }
        } else {
            let index = u32::try_from(self.slots.len()).expect("arena index space exhausted");
            self.slots.push(Slot {
                generation: 1,
                value: Some(value),
                retired: false,
                allocations: 1,
                last_allocated_ms: Some(now),
                last_released_ms: None,
            });
            Handle {
                index,
                generation: 1,
            }
        }
    }

    pub fn get(&self, handle: Handle) -> Option<&T> {
        self.slots
            .get(handle.index as usize)
            .filter(|s| !s.retired && s.generation == handle.generation)
            .and_then(|s| s.value.as_ref())
    }

    pub fn get_mut(&mut self, handle: Handle) -> Option<&mut T> {
        self.slots
            .get_mut(handle.index as usize)
            .filter(|s| !s.retired && s.generation == handle.generation)
            .and_then(|s| s.value.as_mut())
    }

    pub fn remove(&mut self, handle: Handle, now: u64) -> Option<T> {
        let slot = self.slots.get_mut(handle.index as usize)?;
        if slot.retired || slot.generation != handle.generation {
            return None;
        }
        let value = slot.value.take()?;
        self.releases += 1;
        self.occupied -= 1;
        slot.last_released_ms = Some(now);
        if slot.generation == u32::MAX {
            slot.retired = true;
            self.retired += 1;
        } else {
            slot.generation += 1;
            self.free_list.push(handle.index);
        }
        Some(value)
    }

    pub fn free_len(&self) -> usize {
        self.free_list.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_allocation_and_lookup() {
        let mut arena = Arena::default();
        let h = arena.allocate(42, 0);
        assert_eq!(
            h,
            Handle {
                index: 0,
                generation: 1
            }
        );
        assert_eq!(arena.get(h), Some(&42));
        assert_eq!(arena.occupied, 1);
    }

    #[test]
    fn valid_mutation() {
        let mut arena = Arena::default();
        let h = arena.allocate(1, 0);
        *arena.get_mut(h).unwrap() = 7;
        assert_eq!(arena.get(h), Some(&7));
    }

    #[test]
    fn removal_returns_value_and_free_slot() {
        let mut arena = Arena::default();
        let h = arena.allocate(String::from("owned"), 0);
        assert_eq!(arena.remove(h, 5).as_deref(), Some("owned"));
        assert_eq!(arena.free_len(), 1);
        assert_eq!(arena.occupied, 0);
        assert_eq!(arena.slots[0].last_released_ms, Some(5));
    }

    #[test]
    fn reuse_changes_generation_and_rejects_stale() {
        let mut arena = Arena::default();
        let old = arena.allocate(1, 0);
        arena.remove(old, 1);
        let new = arena.allocate(2, 2);
        assert_eq!(old.index, new.index);
        assert_eq!(new.generation, old.generation + 1);
        assert!(arena.get(old).is_none());
        assert!(arena.get_mut(old).is_none());
        assert_eq!(arena.get(new), Some(&2));
        assert_eq!(arena.reused, 1);
    }

    #[test]
    fn invalid_index_and_generation_are_rejected() {
        let mut arena = Arena::default();
        arena.allocate(1, 0);
        assert!(arena
            .get(Handle {
                index: 99,
                generation: 1
            })
            .is_none());
        assert!(arena
            .remove(
                Handle {
                    index: 0,
                    generation: 99
                },
                0
            )
            .is_none());
        assert_eq!(arena.occupied, 1);
    }

    #[test]
    fn double_removal_does_not_duplicate_free_list() {
        let mut arena = Arena::default();
        let h = arena.allocate(1, 0);
        assert_eq!(arena.remove(h, 0), Some(1));
        assert_eq!(arena.remove(h, 0), None);
        assert_eq!(arena.free_len(), 1);
        assert_eq!(arena.releases, 1);
    }

    #[test]
    fn generation_overflow_retires_slot_permanently() {
        let mut arena = Arena::default();
        arena.allocate(1, 0);
        arena.slots[0].generation = u32::MAX;
        let last = Handle {
            index: 0,
            generation: u32::MAX,
        };
        assert_eq!(arena.remove(last, 0), Some(1));
        assert!(arena.slots[0].retired);
        assert_eq!(arena.retired, 1);
        assert_eq!(arena.free_len(), 0);
        let new = arena.allocate(2, 0);
        assert_eq!(new.index, 1);
        assert!(arena.get(last).is_none());
    }

    #[test]
    fn repeated_reuse_has_constant_capacity() {
        let mut arena = Arena::default();
        for n in 0..100_000 {
            let h = arena.allocate(n, n);
            assert_eq!(arena.remove(h, n), Some(n));
        }
        assert_eq!(arena.slots.len(), 1);
        assert_eq!(arena.reused, 99_999);
    }

    #[test]
    fn removal_runs_owned_value_drop() {
        use std::{cell::Cell, rc::Rc};
        struct Owned(Rc<Cell<usize>>);
        impl Drop for Owned {
            fn drop(&mut self) {
                self.0.set(self.0.get() + 1);
            }
        }
        let drops = Rc::new(Cell::new(0));
        let mut arena = Arena::default();
        let h = arena.allocate(Owned(drops.clone()), 0);
        drop(arena.remove(h, 1));
        assert_eq!(drops.get(), 1);
    }
}
