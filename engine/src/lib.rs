use magba::fields::circular_B;
use nalgebra::{Point3, UnitQuaternion, Vector3};
use std::f64::consts::PI;

const LOOP_STRIDE: usize = 8;
const MU0: f64 = 4.0 * PI * 1e-7;

#[derive(Clone, Copy, Debug, Default)]
struct Vec3 {
    x: f64,
    y: f64,
    z: f64,
}

impl Vec3 {
    fn new(x: f64, y: f64, z: f64) -> Self { Self { x, y, z } }
    fn add(self, rhs: Self) -> Self { Self::new(self.x + rhs.x, self.y + rhs.y, self.z + rhs.z) }
    fn sub(self, rhs: Self) -> Self { Self::new(self.x - rhs.x, self.y - rhs.y, self.z - rhs.z) }
    fn scale(self, amount: f64) -> Self { Self::new(self.x * amount, self.y * amount, self.z * amount) }
    fn dot(self, rhs: Self) -> f64 { self.x * rhs.x + self.y * rhs.y + self.z * rhs.z }
    fn cross(self, rhs: Self) -> Self {
        Self::new(
            self.y * rhs.z - self.z * rhs.y,
            self.z * rhs.x - self.x * rhs.z,
            self.x * rhs.y - self.y * rhs.x,
        )
    }
    fn norm(self) -> f64 { self.dot(self).sqrt() }
    fn normalized(self, fallback: Self) -> Self {
        let length = self.norm();
        if length > 1e-14 { self.scale(1.0 / length) } else { fallback }
    }
}

#[derive(Clone, Copy)]
struct Loop {
    center: Vec3,
    normal: Vec3,
    radius: f64,
    current: f64,
}

impl Loop {
    fn from_slice(values: &[f64]) -> Self {
        Self {
            center: Vec3::new(values[0], values[1], values[2]),
            normal: Vec3::new(values[3], values[4], values[5]).normalized(Vec3::new(0.0, 1.0, 0.0)),
            radius: values[6].abs().max(1e-9),
            current: values[7],
        }
    }

    fn field(self, point: Vec3, softening: f64) -> Vec3 {
        if self.current.abs() < 1e-15 { return Vec3::default(); }
        let helper = if self.normal.y.abs() < 0.9 { Vec3::new(0.0, 1.0, 0.0) } else { Vec3::new(1.0, 0.0, 0.0) };
        let u = helper.cross(self.normal).normalized(Vec3::new(1.0, 0.0, 0.0));
        let v = self.normal.cross(u).normalized(Vec3::new(0.0, 0.0, 1.0));
        let displacement = point.sub(self.center);
        let mut local_x = displacement.dot(u);
        let mut local_y = displacement.dot(v);
        let mut local_z = displacement.dot(self.normal);

        let radial = local_x.hypot(local_y);
        let wire_delta = radial - self.radius;
        let wire_distance = wire_delta.hypot(local_z);
        let guard = softening.max(1e-9);
        if wire_distance < guard {
            if wire_distance < 1e-14 {
                local_z = guard;
            } else {
                let ratio = guard / wire_distance;
                let guarded_radial = self.radius + wire_delta * ratio;
                let radial_ratio = guarded_radial / radial.max(1e-14);
                local_x *= radial_ratio;
                local_y *= radial_ratio;
                local_z *= ratio;
            }
        }

        let guarded_point = self.center
            .add(u.scale(local_x))
            .add(v.scale(local_y))
            .add(self.normal.scale(local_z));
        let normal = Vector3::new(self.normal.x, self.normal.y, self.normal.z);
        let orientation = UnitQuaternion::rotation_between(&Vector3::z(), &normal)
            .unwrap_or_else(UnitQuaternion::identity);
        let field = circular_B(
            Point3::new(guarded_point.x, guarded_point.y, guarded_point.z),
            Point3::new(self.center.x, self.center.y, self.center.z),
            orientation,
            self.radius * 2.0,
            self.current,
        ) / MU0;
        Vec3::new(field.x, field.y, field.z)
    }
}

fn field_at(loops: &[Loop], point: Vec3, softening: f64) -> Vec3 {
    loops.iter().fold(Vec3::default(), |field, source| field.add(source.field(point, softening)))
}

fn derivative(loops: &[Loop], point: Vec3, direction: f64, softening: f64) -> Vec3 {
    field_at(loops, point, softening)
        .normalized(Vec3::default())
        .scale(direction)
}

fn rk4(loops: &[Loop], point: Vec3, direction: f64, step: f64, softening: f64) -> Vec3 {
    let k1 = derivative(loops, point, direction, softening);
    let k2 = derivative(loops, point.add(k1.scale(step / 2.0)), direction, softening);
    let k3 = derivative(loops, point.add(k2.scale(step / 2.0)), direction, softening);
    let k4 = derivative(loops, point.add(k3.scale(step)), direction, softening);
    point.add(k1.add(k2.add(k3).scale(2.0)).add(k4).scale(step / 6.0))
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc_f64(length: usize) -> *mut f64 {
    let mut values = Vec::<f64>::with_capacity(length);
    let pointer = values.as_mut_ptr();
    std::mem::forget(values);
    pointer
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc_f64(pointer: *mut f64, capacity: usize) {
    if !pointer.is_null() {
        unsafe { drop(Vec::from_raw_parts(pointer, 0, capacity)); }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn field_batch(
    loops_pointer: *const f64,
    loop_count: usize,
    points_pointer: *const f64,
    point_count: usize,
    output_pointer: *mut f64,
    softening: f64,
) -> u32 {
    if loops_pointer.is_null() || points_pointer.is_null() || output_pointer.is_null() { return 1; }
    let packed_loops = unsafe { std::slice::from_raw_parts(loops_pointer, loop_count * LOOP_STRIDE) };
    let points = unsafe { std::slice::from_raw_parts(points_pointer, point_count * 3) };
    let output = unsafe { std::slice::from_raw_parts_mut(output_pointer, point_count * 3) };
    let loops: Vec<Loop> = packed_loops.chunks_exact(LOOP_STRIDE).map(Loop::from_slice).collect();

    for (index, values) in points.chunks_exact(3).enumerate() {
        let field = field_at(&loops, Vec3::new(values[0], values[1], values[2]), softening);
        output[index * 3] = field.x;
        output[index * 3 + 1] = field.y;
        output[index * 3 + 2] = field.z;
    }
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn trace_line(
    loops_pointer: *const f64,
    loop_count: usize,
    seed_pointer: *const f64,
    direction: f64,
    step_size: f64,
    max_steps: usize,
    bounds: f64,
    softening: f64,
    output_pointer: *mut f64,
    output_capacity_points: usize,
) -> usize {
    if loops_pointer.is_null() || seed_pointer.is_null() || output_pointer.is_null() { return 0; }
    let packed_loops = unsafe { std::slice::from_raw_parts(loops_pointer, loop_count * LOOP_STRIDE) };
    let seed = unsafe { std::slice::from_raw_parts(seed_pointer, 3) };
    let output = unsafe { std::slice::from_raw_parts_mut(output_pointer, output_capacity_points * 3) };
    let loops: Vec<Loop> = packed_loops.chunks_exact(LOOP_STRIDE).map(Loop::from_slice).collect();
    let mut point = Vec3::new(seed[0], seed[1], seed[2]);
    let limit = max_steps.min(output_capacity_points.saturating_sub(1));
    let mut written = 0;

    for _ in 0..=limit {
        output[written * 3] = point.x;
        output[written * 3 + 1] = point.y;
        output[written * 3 + 2] = point.z;
        written += 1;
        if field_at(&loops, point, softening).norm() < 1e-10 { break; }
        point = rk4(&loops, point, direction.signum(), step_size, softening);
        if !point.x.is_finite() || !point.y.is_finite() || !point.z.is_finite() { break; }
        if point.x.abs().max(point.y.abs()).max(point.z.abs()) > bounds { break; }
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loop_center_matches_closed_form_in_normalized_units() {
        let source = Loop { center: Vec3::default(), normal: Vec3::new(0.0, 1.0, 0.0), radius: 2.0, current: 3.0 };
        let field = source.field(Vec3::default(), 1e-6);
        assert!((field.y - 0.75).abs() < 1e-10, "{}", field.y);
        assert!(field.x.abs() < 1e-12 && field.z.abs() < 1e-12);
    }

    #[test]
    fn polarity_reverses_field() {
        let positive = Loop { center: Vec3::default(), normal: Vec3::new(0.0, 1.0, 0.0), radius: 1.0, current: 1.0 };
        let negative = Loop { current: -1.0, ..positive };
        let a = positive.field(Vec3::new(0.2, 0.5, 0.1), 1e-6);
        let b = negative.field(Vec3::new(0.2, 0.5, 0.1), 1e-6);
        assert!((a.x + b.x).abs() < 1e-12);
        assert!((a.y + b.y).abs() < 1e-12);
        assert!((a.z + b.z).abs() < 1e-12);
    }
}
