import React, { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { useAuth } from './AuthContext';

const CourseContext = createContext();

export const useCourse = () => useContext(CourseContext);

export const CourseProvider = ({ children }) => {
  const { user, role } = useAuth();
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setCourses([]);
      setSelectedCourse(null);
      setLoading(false);
      return;
    }

    const fetchCourses = async () => {
      try {
        setLoading(true);
        // First get the user's document to see their roles/assigned courses
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const userData = userDoc.exists() ? userDoc.data() : null;
        
        const isSuperAdmin = role === 'superadmin' || (userData?.roles && userData.roles['global'] === 'superadmin');

        // Fetch all courses
        const snapshot = await getDocs(collection(db, 'courses'));
        const allCourses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        let availableCourses = [];
        
        if (isSuperAdmin) {
          availableCourses = allCourses;
        } else if (userData && userData.roles) {
          // If admin/presidente/tesorero, only show courses they have a role in
          const assignedCourseIds = Object.keys(userData.roles).filter(k => k !== 'global' && (userData.roles[k] === 'presidente' || userData.roles[k] === 'tesorero' || userData.roles[k] === 'admin'));
          availableCourses = allCourses.filter(c => assignedCourseIds.includes(c.id));
        }

        setCourses(availableCourses);

        // Auto-select a course if none is selected
        if (availableCourses.length > 0) {
          // Try to select defaultCourseId if it exists and is available
          const defaultId = userData?.defaultCourseId;
          const defaultCourse = availableCourses.find(c => c.id === defaultId);
          
          if (defaultCourse) {
            setSelectedCourse(defaultCourse);
          } else {
            setSelectedCourse(availableCourses[0]);
          }
        }
      } catch (error) {
        console.error("Error fetching courses:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchCourses();
  }, [user, role]);

  const changeCourse = async (courseId) => {
    const course = courses.find(c => c.id === courseId);
    if (course) {
      setSelectedCourse(course);
      // Optional: save preference to user doc
    }
  };

  return (
    <CourseContext.Provider value={{ 
      courses, 
      selectedCourse, 
      changeCourse, 
      loadingCourses: loading,
      refreshCourses: async () => {
        const snapshot = await getDocs(collection(db, 'courses'));
        setCourses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }
    }}>
      {children}
    </CourseContext.Provider>
  );
};
